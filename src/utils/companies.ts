/**
 * OPT-friendly company list  → +3 score bonus
 * Blacklisted companies       → rejected before storage (defense / gov contractors)
 */

const OPT_FRIENDLY: string[] = [
  // Big tech
  'amazon', 'aws', 'google', 'alphabet', 'microsoft', 'meta', 'apple', 'netflix',
  // Cybersecurity
  'cloudflare', 'palo alto networks', 'crowdstrike', 'sentinelone', 'zscaler',
  'lacework', 'wiz', 'orca security', 'axonius', 'panther labs',
  'rapid7', 'qualys', 'tenable', 'bugcrowd', 'hackerone', 'secureworks',
  'veracode', 'snyk', 'cyberark', 'beyond trust', 'sailpoint', 'varonis',
  'darktrace', 'cybereason', 'illumio', 'vectra', 'abnormal security',
  // Cloud / DevOps
  'hashicorp', 'databricks', 'snowflake', 'mongodb', 'confluent', 'cockroachdb',
  'datadog', 'new relic', 'pagerduty', 'splunk', 'elastic', 'sumo logic',
  'dynatrace', 'grafana labs', 'influxdata',
  'docker', 'gitlab', 'github', 'atlassian', 'jfrog', 'harness', 'circle ci',
  'digitalocean', 'linode', 'akamai', 'fastly', 'cloudinary',
  // SaaS / Web
  'stripe', 'twilio', 'sendgrid', 'okta', 'auth0', 'ping identity',
  'shopify', 'hubspot', 'salesforce', 'servicenow', 'zendesk', 'freshworks',
  // Linux / Open source
  'red hat', 'suse', 'canonical', 'vmware', 'nutanix', 'rancher',
  // Networking / Infra
  'cisco', 'fortinet', 'check point', 'f5', 'juniper',
];

const BLACKLISTED: string[] = [
  // Defense primes
  'lockheed martin', 'raytheon', 'boeing', 'northrop grumman', 'general dynamics',
  // Gov IT contractors
  'saic', 'leidos', 'booz allen hamilton', 'booz allen', 'caci', 'mantech',
  'peraton', 'perspecta', 'vectrus', 'engility', 'l3harris',
  'bae systems', 'parsons corporation', 'keyw', 'chenega',
];

export function isBlacklisted(company: string): boolean {
  const lc = company.toLowerCase();
  return BLACKLISTED.some(b => lc.includes(b));
}

export function optBonus(company: string): number {
  const lc = company.toLowerCase();
  return OPT_FRIENDLY.some(c => lc.includes(c)) ? 3 : 0;
}
