import { join } from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface FactoryStackProps extends cdk.StackProps {
  /** If set, subscribes this address to the gate-notification topic on deploy. */
  gateNotifyEmail?: string;
}

const HANDLERS_DIR = join(__dirname, "..", "src", "handlers");

/**
 * Phase 1 of the Spec-to-PR Factory (docs/02-spec-to-pr-factory.md §13): intake ->
 * recon -> analyst -> Gate A -> publisher, deliberately simplified everywhere the
 * full design's complexity isn't earned yet:
 *   - Recon is a Lambda reading the GitHub API, not a CodeBuild clone (no coder stage
 *     exists yet to need an isolated execution environment — that's Phase 3).
 *   - The human-in-the-loop surface is one bearer-token API, not Cognito + AppSync +
 *     a React SPA (docs/02 §9) — worth building once there's more than one gate.
 *   - One DynamoDB table, one S3 bucket, one state machine. No revision DAG yet since
 *     there is only ever one stage sequence to revise (docs/02 §3's reprocess model
 *     applies from Phase 2 onward, once an Architect stage exists to reprocess into).
 */
export class FactoryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: FactoryStackProps) {
    super(scope, id, props);

    // ---- Storage -----------------------------------------------------------------
    const artifactBucket = new s3.Bucket(this, "ArtifactBucket", {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const table = new dynamodb.TableV2(this, "RunTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---- Secrets: GitHub credentials + the operator bearer token ------------------
    // Created empty; fill in after deploy (see factory/README.md). A PAT is the
    // fastest way to try this out — swap to the githubApp* fields for the short-lived,
    // repo-scoped credential the design calls for in production (ADR 0008).
    const githubSecret = new secretsmanager.Secret(this, "GithubSecret", {
      description: "githubToken (PAT) OR githubAppId+githubAppPrivateKey+githubAppInstallationId, plus githubWebhookSecret",
    });
    const apiToken = new secretsmanager.Secret(this, "ApiToken", {
      description: "Bearer token for POST /runs and gate decisions",
      generateSecretString: { excludePunctuation: true, passwordLength: 32 },
    });

    // ---- Notifications --------------------------------------------------------------
    const gateTopic = new sns.Topic(this, "GateNotifications");
    if (props?.gateNotifyEmail) {
      gateTopic.addSubscription(new subscriptions.EmailSubscription(props.gateNotifyEmail));
    }

    // ---- State machine's Lambda tasks ----------------------------------------------
    const commonEnv = {
      ARTIFACT_BUCKET: artifactBucket.bucketName,
      TABLE_NAME: table.tableName,
      GITHUB_SECRET_ARN: githubSecret.secretArn,
    };

    // Kept as one constant so the IAM grant below can never drift from what the
    // analyst Lambda is actually configured to call.
    const bedrockModelId = "anthropic.claude-sonnet-5-20260101-v1:0";

    const intakeFn = this.fn("Intake", "intake.ts", commonEnv);
    const reconFn = this.fn("Recon", "recon.ts", commonEnv);
    const analystFn = this.fn(
      "Analyst",
      "analyst.ts",
      { ...commonEnv, FACTORY_LLM_PROVIDER: "bedrock", BEDROCK_MODEL_ID: bedrockModelId },
      { timeout: cdk.Duration.minutes(5) },
    );
    const gateWaitStartFn = this.fn("GateWaitStart", "gateWaitStart.ts", {
      TABLE_NAME: table.tableName,
      NOTIFY_TOPIC_ARN: gateTopic.topicArn,
    });
    const publisherFn = this.fn("Publisher", "publisher.ts", commonEnv);

    for (const fn of [intakeFn, reconFn, publisherFn]) {
      artifactBucket.grantReadWrite(fn);
      table.grantReadWriteData(fn);
      githubSecret.grantRead(fn);
    }
    // Scoped to this one model, in this region. Switch to an inference-profile ARN
    // (arn:aws:bedrock:*:<account>:inference-profile/...) once throughput needs the
    // cross-region routing docs/02-spec-to-pr-factory.md §5 describes.
    analystFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${bedrockModelId}`],
      }),
    );
    artifactBucket.grantReadWrite(analystFn);
    table.grantReadWriteData(analystFn);
    table.grantWriteData(gateWaitStartFn);
    gateTopic.grantPublish(gateWaitStartFn);

    // ---- State machine --------------------------------------------------------------
    const intakeTask = new tasks.LambdaInvoke(this, "IntakeTask", { lambdaFunction: intakeFn, resultPath: "$.intake", payloadResponseOnly: true });
    const reconTask = new tasks.LambdaInvoke(this, "ReconTask", { lambdaFunction: reconFn, resultPath: "$.repoFacts", payloadResponseOnly: true });
    const analystTask = new tasks.LambdaInvoke(this, "AnalystTask", { lambdaFunction: analystFn, resultPath: "$.requirements", payloadResponseOnly: true });

    const gateATask = new tasks.LambdaInvoke(this, "GateATask", {
      lambdaFunction: gateWaitStartFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      // Gate A's HeartbeatSeconds is the abandoned-approval timeout from docs/02 §3
      // (default there: 14 days). The task token lives as long as the execution, so
      // there is no separate token expiry to track.
      heartbeatTimeout: sfn.Timeout.duration(cdk.Duration.days(14)),
      payload: sfn.TaskInput.fromObject({
        run: sfn.JsonPath.objectAt("$.run"),
        requirements: sfn.JsonPath.objectAt("$.requirements"),
        taskToken: sfn.JsonPath.taskToken,
      }),
      resultPath: "$.gateADecision",
    });

    const publisherTask = new tasks.LambdaInvoke(this, "PublisherTask", { lambdaFunction: publisherFn, resultPath: "$.publisher", payloadResponseOnly: true });

    // The Gate A clarification loop from docs/02 §2: "otherwise" points back at the
    // very same analystTask node used in the forward path below, so a rejection
    // re-enters the state machine at the analyst — never at intake or recon. Each
    // state's `.next()` is still called exactly once; analystTask simply has two
    // *incoming* edges (from recon, and from this choice), which ASL supports natively.
    const gateChoice = new sfn.Choice(this, "GateADecision")
      .when(sfn.Condition.stringEquals("$.gateADecision.decision", "approve"), publisherTask.next(new sfn.Succeed(this, "Published")))
      .otherwise(analystTask);

    const definition = intakeTask.next(reconTask).next(analystTask).next(gateATask).next(gateChoice);

    const logGroup = new logs.LogGroup(this, "StateMachineLogs", { retention: logs.RetentionDays.ONE_MONTH });

    const stateMachine = new sfn.StateMachine(this, "StateMachine", {
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      logs: { destination: logGroup, level: sfn.LogLevel.ALL },
      tracingEnabled: true,
    });

    // ---- HTTP API -------------------------------------------------------------------
    const webhookFn = this.fn("Webhook", "webhook.ts", { GITHUB_SECRET_ARN: githubSecret.secretArn, STATE_MACHINE_ARN: stateMachine.stateMachineArn });
    const manualStartFn = this.fn("ManualStart", "manualStart.ts", { STATE_MACHINE_ARN: stateMachine.stateMachineArn, API_TOKEN_SECRET_ARN: apiToken.secretArn });
    const gateDecisionFn = this.fn("GateDecision", "gateDecision.ts", { TABLE_NAME: table.tableName, API_TOKEN_SECRET_ARN: apiToken.secretArn });

    stateMachine.grantStartExecution(webhookFn);
    stateMachine.grantStartExecution(manualStartFn);
    githubSecret.grantRead(webhookFn);
    apiToken.grantRead(manualStartFn);
    apiToken.grantRead(gateDecisionFn);
    table.grantReadWriteData(gateDecisionFn);
    // SendTaskSuccess/SendTaskFailure address a task token, not a state machine ARN —
    // Step Functions does not support resource-level permissions for these two actions,
    // so the policy must grant "*" here or the call is denied at runtime regardless of
    // which state machine issued the token.
    gateDecisionFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["states:SendTaskSuccess", "states:SendTaskFailure"], resources: ["*"] }),
    );

    const httpApi = new apigwv2.HttpApi(this, "HttpApi", { description: "Spec-to-PR Factory Phase 1" });
    httpApi.addRoutes({ path: "/webhooks/github", methods: [apigwv2.HttpMethod.POST], integration: new integrations.HttpLambdaIntegration("WebhookIntegration", webhookFn) });
    httpApi.addRoutes({ path: "/runs", methods: [apigwv2.HttpMethod.POST], integration: new integrations.HttpLambdaIntegration("ManualStartIntegration", manualStartFn) });
    httpApi.addRoutes({
      path: "/runs/{runId}/gates/{gateId}/decision",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("GateDecisionIntegration", gateDecisionFn),
    });

    gateWaitStartFn.addEnvironment("DECISION_API_BASE_URL", httpApi.apiEndpoint);

    new cdk.CfnOutput(this, "ApiEndpoint", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "GithubSecretArn", { value: githubSecret.secretArn });
    new cdk.CfnOutput(this, "ApiTokenSecretArn", { value: apiToken.secretArn });
    new cdk.CfnOutput(this, "ArtifactBucketName", { value: artifactBucket.bucketName });
    new cdk.CfnOutput(this, "StateMachineArn", { value: stateMachine.stateMachineArn });
  }

  private fn(id: string, entryFile: string, env: Record<string, string>, extra?: Partial<nodejs.NodejsFunctionProps>): nodejs.NodejsFunction {
    return new nodejs.NodejsFunction(this, `${id}Fn`, {
      entry: join(HANDLERS_DIR, entryFile),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: env,
      bundling: { format: nodejs.OutputFormat.CJS },
      ...extra,
    });
  }
}
