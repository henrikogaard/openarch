import type { ArchiElement, Domain, Model, View } from '@openarch/core';

export interface StandardRequirement {
  id: string;
  title: string;
  description: string;
  category: string;
}

export interface StandardsPack {
  id: string;
  name: string;
  description: string;
  requirements: StandardRequirement[];
}

/**
 * Concise, well-known control themes for common architecture governance
 * frameworks. Requirement ids are local slugs; article and control numbers are
 * deliberately omitted where they would be easy to misstate.
 */
export const STANDARDS_PACKS: StandardsPack[] = [
  {
    id: 'nist-csf',
    name: 'NIST CSF 2.0',
    description:
      'Outcome-based cybersecurity risk management across govern, identify, protect, detect, respond, and recover.',
    requirements: [
      {
        id: 'governance',
        title: 'Cybersecurity governance',
        description:
          'Establish and communicate a cybersecurity risk management strategy, roles, responsibilities, and accountability.',
        category: 'Govern',
      },
      {
        id: 'asset-inventory',
        title: 'Asset inventory',
        description:
          'Maintain an inventory of hardware, software, data, services, and their owners and criticality.',
        category: 'Identify',
      },
      {
        id: 'risk-assessment',
        title: 'Risk assessment',
        description:
          'Identify and assess cybersecurity risks to the architecture and its information assets.',
        category: 'Identify',
      },
      {
        id: 'identity-access',
        title: 'Identity and access management',
        description:
          'Authenticate users and services and enforce least-privilege access to architecture components.',
        category: 'Protect',
      },
      {
        id: 'data-security',
        title: 'Data security',
        description:
          'Protect data at rest and in transit according to classification and retention requirements.',
        category: 'Protect',
      },
      {
        id: 'platform-security',
        title: 'Platform security',
        description:
          'Harden and patch platforms, applications, and infrastructure using secure configuration baselines.',
        category: 'Protect',
      },
      {
        id: 'awareness-training',
        title: 'Awareness and training',
        description:
          'Provide role-based security awareness and secure development training.',
        category: 'Protect',
      },
      {
        id: 'continuous-monitoring',
        title: 'Continuous monitoring',
        description:
          'Monitor systems and networks for anomalous activity and security events.',
        category: 'Detect',
      },
      {
        id: 'incident-response',
        title: 'Incident response',
        description:
          'Maintain and exercise an incident response plan with defined roles and communication paths.',
        category: 'Respond',
      },
      {
        id: 'recovery',
        title: 'Recovery planning',
        description:
          'Maintain recovery plans and backups, and test restoration of critical services.',
        category: 'Recover',
      },
      {
        id: 'supply-chain',
        title: 'Supply chain risk',
        description:
          'Assess and monitor cybersecurity risk from suppliers and third-party components.',
        category: 'Identify',
      },
    ],
  },
  {
    id: 'iso-27001',
    name: 'ISO/IEC 27001:2022',
    description:
      'Information security management system requirements and commonly used Annex A control themes.',
    requirements: [
      {
        id: 'isms-scope',
        title: 'Information security management system',
        description:
          'Define, maintain, and continually improve an ISMS covering the architecture scope.',
        category: 'Governance',
      },
      {
        id: 'risk-treatment',
        title: 'Risk treatment',
        description:
          'Identify information security risks and select proportionate treatment options.',
        category: 'Risk management',
      },
      {
        id: 'roles-responsibilities',
        title: 'Roles and responsibilities',
        description:
          'Assign information security responsibilities and segregate conflicting duties.',
        category: 'Organization',
      },
      {
        id: 'asset-management',
        title: 'Asset management',
        description:
          'Inventory information assets and define acceptable use and ownership.',
        category: 'Organization',
      },
      {
        id: 'access-control',
        title: 'Access control',
        description:
          'Apply least-privilege access control and review access rights regularly.',
        category: 'Technology',
      },
      {
        id: 'supplier-security',
        title: 'Supplier security',
        description:
          'Agree and monitor information security requirements with suppliers.',
        category: 'Organization',
      },
      {
        id: 'secure-development',
        title: 'Secure development',
        description:
          'Integrate security requirements and testing into the development lifecycle.',
        category: 'Technology',
      },
      {
        id: 'vulnerability-management',
        title: 'Vulnerability management',
        description:
          'Identify, prioritize, and remediate technical vulnerabilities.',
        category: 'Technology',
      },
      {
        id: 'logging-monitoring',
        title: 'Logging and monitoring',
        description:
          'Record security events and monitor them for timely detection.',
        category: 'Technology',
      },
      {
        id: 'business-continuity',
        title: 'Business continuity',
        description:
          'Plan and test information security continuity for disruptive events.',
        category: 'Operations',
      },
      {
        id: 'incident-management',
        title: 'Incident management',
        description:
          'Report, assess, and respond to information security incidents consistently.',
        category: 'Operations',
      },
      {
        id: 'physical-security',
        title: 'Physical security',
        description:
          'Protect facilities and equipment from physical and environmental threats.',
        category: 'Physical',
      },
    ],
  },
  {
    id: 'dora',
    name: 'DORA',
    description:
      'Digital operational resilience requirements for ICT risk, incidents, testing, and third-party providers.',
    requirements: [
      {
        id: 'ict-governance',
        title: 'ICT risk governance',
        description:
          'Define and maintain an ICT risk management framework with clear accountability.',
        category: 'Governance',
      },
      {
        id: 'ict-asset-inventory',
        title: 'ICT asset inventory',
        description:
          'Maintain an inventory of ICT assets, dependencies, and critical functions.',
        category: 'Risk management',
      },
      {
        id: 'business-continuity',
        title: 'Business continuity and recovery',
        description:
          'Maintain business continuity and disaster recovery plans for ICT disruptions.',
        category: 'Resilience',
      },
      {
        id: 'incident-management',
        title: 'ICT incident management',
        description:
          'Detect, manage, and report ICT-related incidents using a defined process.',
        category: 'Incident management',
      },
      {
        id: 'incident-reporting',
        title: 'Incident reporting',
        description:
          'Report major ICT incidents to regulators and affected parties within required timelines.',
        category: 'Incident management',
      },
      {
        id: 'resilience-testing',
        title: 'Digital operational resilience testing',
        description:
          'Run regular resilience tests, including threat-led penetration testing where required.',
        category: 'Testing',
      },
      {
        id: 'third-party-risk',
        title: 'ICT third-party risk',
        description:
          'Assess, contract, and monitor ICT service providers throughout the lifecycle.',
        category: 'Third-party risk',
      },
      {
        id: 'concentration-risk',
        title: 'Concentration risk',
        description:
          'Identify and manage dependencies on critical ICT providers.',
        category: 'Third-party risk',
      },
      {
        id: 'information-sharing',
        title: 'Information sharing',
        description:
          'Share threat intelligence within trusted communities while protecting sensitive information.',
        category: 'Cooperation',
      },
      {
        id: 'situational-awareness',
        title: 'Situational awareness',
        description:
          'Maintain up-to-date knowledge of ICT threats and vulnerabilities affecting critical services.',
        category: 'Governance',
      },
    ],
  },
  {
    id: 'gdpr',
    name: 'GDPR',
    description:
      'Data protection principles, data subject rights, accountability, and security obligations.',
    requirements: [
      {
        id: 'lawful-basis',
        title: 'Lawful processing basis',
        description:
          'Record a lawful basis for each processing activity involving personal data.',
        category: 'Principles',
      },
      {
        id: 'data-minimization',
        title: 'Data minimization',
        description:
          'Collect and retain only personal data necessary for the stated purpose.',
        category: 'Principles',
      },
      {
        id: 'purpose-limitation',
        title: 'Purpose limitation',
        description:
          'Use personal data only for specified, explicit, and legitimate purposes.',
        category: 'Principles',
      },
      {
        id: 'storage-limitation',
        title: 'Storage limitation',
        description:
          'Define retention periods and delete or anonymize personal data when no longer needed.',
        category: 'Principles',
      },
      {
        id: 'consent-management',
        title: 'Consent management',
        description:
          'Capture, record, and withdraw consent where consent is the lawful basis.',
        category: 'Rights',
      },
      {
        id: 'data-subject-rights',
        title: 'Data subject rights',
        description:
          'Support access, rectification, erasure, restriction, portability, and objection requests.',
        category: 'Rights',
      },
      {
        id: 'privacy-by-design',
        title: 'Privacy by design',
        description:
          'Embed data protection principles and default settings into systems and architecture.',
        category: 'Engineering',
      },
      {
        id: 'records-of-processing',
        title: 'Records of processing',
        description:
          'Maintain records of processing activities, including purposes, categories, and recipients.',
        category: 'Accountability',
      },
      {
        id: 'data-breach-response',
        title: 'Data breach response',
        description:
          'Detect, assess, and notify personal data breaches within required timelines.',
        category: 'Security',
      },
      {
        id: 'impact-assessment',
        title: 'Data protection impact assessment',
        description:
          'Assess high-risk processing before it begins and document mitigations.',
        category: 'Risk',
      },
      {
        id: 'international-transfers',
        title: 'International transfers',
        description:
          'Apply appropriate safeguards when personal data leaves its jurisdiction.',
        category: 'Compliance',
      },
      {
        id: 'processor-agreements',
        title: 'Processor agreements',
        description:
          'Contract processors with documented data protection obligations.',
        category: 'Third parties',
      },
    ],
  },
];

function slug(value: string): string {
  const slugged = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slugged || 'requirement';
}

function ensureComplianceDomain(domains: Domain[]): Domain {
  const existing = domains.find(
    (domain) => domain.name.trim().toLowerCase() === 'compliance',
  );
  if (existing) return existing;

  let id = 'domain-compliance';
  let suffix = 2;
  while (domains.some((domain) => domain.id === id)) {
    id = `domain-compliance-${suffix}`;
    suffix += 1;
  }

  const domain: Domain = { id, name: 'Compliance' };
  domains.push(domain);
  return domain;
}

/**
 * Add a standards pack to a model as Requirement elements in a Compliance
 * domain, plus a view listing them. The input model is never mutated.
 */
export function applyStandardsPack(model: Model, packId: string): Model {
  const pack = STANDARDS_PACKS.find((candidate) => candidate.id === packId);
  if (!pack) {
    throw new Error(
      `Unknown standards pack: ${packId}. Available packs: ${STANDARDS_PACKS.map((candidate) => candidate.id).join(', ')}.`,
    );
  }

  const domains = [...(model.domains ?? [])];
  const complianceDomain = ensureComplianceDomain(domains);

  const requirementElements: ArchiElement[] = pack.requirements.map((requirement) => ({
    id: `req-${pack.id}-${slug(requirement.id)}`,
    type: 'Requirement',
    name: [{ lang: 'en', value: requirement.title }],
    documentation: [{ lang: 'en', value: requirement.description }],
    properties: [
      { key: 'standard', value: pack.id },
      { key: 'control', value: requirement.id },
    ],
    domain: complianceDomain.id,
  }));

  const existingIds = new Set(model.elements.map((element) => element.id));
  const newElements = requirementElements.filter((element) => !existingIds.has(element.id));

  const viewId = `view-compliance-${pack.id}`;
  const view: View = {
    id: viewId,
    type: 'Diagram',
    name: [{ lang: 'en', value: `Compliance – ${pack.id}` }],
    nodes: requirementElements.map((element, index) => ({
      id: `node-${element.id}`,
      type: 'Element',
      elementRef: element.id,
      label: [],
      bounds: {
        x: 40 + (index % 3) * 260,
        y: 40 + Math.floor(index / 3) * 100,
        w: 220,
        h: 70,
      },
    })),
    edges: [],
  };

  const views = model.views.some((candidate) => candidate.id === viewId)
    ? model.views.map((candidate) => (candidate.id === viewId ? view : candidate))
    : [...model.views, view];

  return {
    ...model,
    domains,
    elements: [...model.elements, ...newElements],
    relationships: [...model.relationships],
    views,
    artefacts: [...(model.artefacts ?? [])],
    properties: [...model.properties],
    propertyDefinitions: [...model.propertyDefinitions],
  };
}
