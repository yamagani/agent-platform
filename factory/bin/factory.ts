#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { FactoryStack } from "../lib/factory-stack";

const app = new cdk.App();

new FactoryStack(app, "SpecToPrFactory", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  gateNotifyEmail: app.node.tryGetContext("gateNotifyEmail") as string | undefined,
});
