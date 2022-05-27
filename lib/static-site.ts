import {
  CfnOutput,
  RemovalPolicy
} from 'aws-cdk-lib';

import {
  aws_cloudfront as cloudfront,
  aws_route53 as route53,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_certificatemanager as acm,
  aws_route53_targets as targets,
} from 'aws-cdk-lib';

import { Construct } from 'constructs';

export interface StaticSiteProps {
  domainName: string;
}

/**
 * Static site infrastructure, which deploys site content to an S3 bucket.
 *
 * The site redirects from HTTP to HTTPS, using a CloudFront distribution,
 * Route53 alias record, and ACM certificate.
 */
export class StaticSite extends Construct {
  constructor(parent: Construct, name: string, props: StaticSiteProps) {
    super(parent, name);

    const { domainName } = props;
    const www = "www." + domainName;
    const zone = route53.HostedZone.fromLookup(this, "Zone", { domainName });
    new CfnOutput(this, "SiteWithSubDomain", { value: "https://" + www });

    // Content bucket
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      bucketName: www,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "error.html",
      publicReadAccess: true,

      // The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
      // the new bucket, and it will remain in your account until manually deleted. By setting the policy to
      // DESTROY, cdk destroy will attempt to delete the bucket, but will error if the bucket is not empty.
      removalPolicy: RemovalPolicy.DESTROY // NOT recommended for production code
    });

    new CfnOutput(this, "Bucket", { value: siteBucket.bucketName });

    // naturism.is => www.naturism.is
    const redirectBucket = new s3.Bucket(this, "RedirectBucket", {
      bucketName: domainName,
      websiteRedirect: {
        hostName: www,
        protocol: s3.RedirectProtocol.HTTPS,
      },
    });

    new CfnOutput(this, "RedirectedBucket", { value: redirectBucket.bucketName });

    // Route53 alias record for naturism.is => www.
    new route53.ARecord(this, "RedirectAliasRecord", {
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.BucketWebsiteTarget(redirectBucket)
      ),
      zone
    });

    // TLS certificate
    const certificateArn = new acm.DnsValidatedCertificate(
      this,
      "SiteCertificate",
      {
        domainName: "www." + domainName,
        subjectAlternativeNames: [domainName],
        hostedZone: zone
      }
    ).certificateArn;
    new CfnOutput(this, "Certificate", { value: certificateArn });

    // CloudFront distribution that provides HTTPS
    const distribution = new cloudfront.CloudFrontWebDistribution(
      this,
      "SiteDistribution",
      {
        viewerCertificate: cloudfront.ViewerCertificate.fromAcmCertificate(
          acm.Certificate.fromCertificateArn(this, 'AliasConfigurationCert', certificateArn),
          {
            aliases: [www],
            sslMethod: cloudfront.SSLMethod.SNI,
            securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016
          }
        ),
        originConfigs: [
          {
            s3OriginSource: {
              s3BucketSource: siteBucket
            },
            behaviors: [{ isDefaultBehavior: true }]
          }
        ]
      }
    );
    new CfnOutput(this, "DistributionId", {
      value: distribution.distributionId
    });

    // Route53 alias record for the CloudFront distribution
    new route53.ARecord(this, "SiteWithSubdomainAliasRecord", {
      recordName: www,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
      zone
    });

    // Deploy site contents to S3 bucket
    new s3deploy.BucketDeployment(this, "DeployWithInvalidation", {
      sources: [s3deploy.Source.asset("./website")],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"]
    });
  }
}
