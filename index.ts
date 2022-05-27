import { Stack, App, StackProps } from 'aws-cdk-lib';
import { StaticSite } from './lib/static-site';

export class NaturismIsStack extends Stack {
  constructor(parent: App, name: string, props: StackProps) {
    super(parent, name, props);

    new StaticSite(this, 'StaticSite', {
      domainName: this.node.tryGetContext('domain'),
    });
 }
}
