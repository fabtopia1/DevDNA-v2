import { EvidenceSubject } from '../evidence/types.js';
import type { EvidenceLedger } from '../evidence/ledger.js';
import {
  Determinacy,
  InferenceDirection,
  ModuleId,
  FindingBasis,
  Severity,
  type Finding,
  type Inference,
  type ModuleResult,
  type Verdict,
} from '../inference/types.js';
import type { ProvenanceEngine } from '../inference/provenance.js';
import { clamp01, corroborate, round } from '../confidence/model.js';
import { massFor } from './support.js';

/**
 * Module 5 - the SecurityDNA Engine.
 *
 * Two jobs: detect operating-system integrity compromise, and report the
 * security posture a buyer inherits with the handset.
 *
 * The first matters more than it appears, because it is *upstream of everything
 * else DevDNA does*. Every value in the ledger comes from the device's own
 * operating system. If that system is modified, none of the other modules'
 * conclusions can be trusted, which is why a positive integrity finding
 * collapses the whole trust score rather than deducting from it.
 *
 * DevDNA is explicit that this is detection, not prevention: a sufficiently
 * determined adversary can defeat it, and the report says so.
 */

export enum SecurityVerdict {
  POSTURE_CLEAN = 'POSTURE_CLEAN',
  POSTURE_ATTENTION = 'POSTURE_ATTENTION',
  POSTURE_COMPROMISED = 'POSTURE_COMPROMISED',
  CANNOT_DETERMINE = 'CANNOT_DETERMINE',
}

export interface SecurityDetail extends Record<string, unknown> {
  /** 0-100 posture score. Distinct from the trust score. */
  postureScore: number;
  integrityCompromised: boolean;
  jailbreakIndicators: string[];
  activationLockEnabled: boolean | null;
  activated: boolean | null;
  supervised: boolean | null;
  mdmEnrolled: boolean | null;
  developerModeEnabled: boolean | null;
  passcodeSet: boolean | null;
  /** Ordered list of posture deductions, each with its reason. */
  deductions: Array<{ code: string; points: number; reason: string }>;
}

export function runSecurityEngine(
  ledger: EvidenceLedger,
  provenance: ProvenanceEngine,
  at: string,
): { result: ModuleResult<SecurityVerdict>; findings: Finding[]; detail: SecurityDetail } {
  const inferences: Inference[] = [];
  const findings: Finding[] = [];
  const jailbreakIndicators: string[] = [];
  const deductions: SecurityDetail['deductions'] = [];

  const derive = (input: {
    rule: string;
    direction: InferenceDirection;
    statement: string;
    weight: number;
    ruleConfidence: number;
    evidenceIds: string[];
  }): Inference => {
    const inference = provenance.derive({
      module: ModuleId.SECURITY_DNA,
      subject: EvidenceSubject.SECURITY_STATE,
      at,
      ...input,
    });
    inferences.push(inference);
    return inference;
  };

  let postureScore = 100;
  const deduct = (code: string, points: number, reason: string): void => {
    postureScore -= points;
    deductions.push({ code, points, reason });
  };

  // --- Integrity: jailbreak indicators -------------------------------------
  const bundleRecords = ledger.forSubject(EvidenceSubject.SECURITY_STATE, 'JailbreakBundlePresent');
  const serviceRecords = ledger.forSubject(
    EvidenceSubject.SECURITY_STATE,
    'UnsandboxedServiceAdvertised',
  );

  for (const record of bundleRecords) {
    jailbreakIndicators.push(`installed application ${record.value}`);
    derive({
      rule: 'security.jailbreak-bundle-present',
      direction: InferenceDirection.SUPPORTS_NEGATIVE,
      statement: `${record.value} is installed, and exists only on jailbroken systems`,
      weight: 0.95,
      ruleConfidence: 0.9,
      evidenceIds: [record.id],
    });
  }
  for (const record of serviceRecords) {
    jailbreakIndicators.push(`lockdown service ${record.value}`);
    derive({
      rule: 'security.unsandboxed-service',
      direction: InferenceDirection.SUPPORTS_NEGATIVE,
      statement: `The device advertises ${record.value}, which stock iOS never does`,
      weight: 0.9,
      ruleConfidence: 0.88,
      evidenceIds: [record.id],
    });
  }

  const integrityCompromised = jailbreakIndicators.length > 0;
  if (integrityCompromised) {
    deduct('JAILBREAK_INDICATORS', 55, `Detected: ${jailbreakIndicators.join(', ')}`);
    findings.push({
      code: 'SECURITY_INTEGRITY_COMPROMISED',
      basis: FindingBasis.EVIDENCE,
      severity: Severity.CRITICAL,
      module: ModuleId.SECURITY_DNA,
      title: 'Operating system integrity indicators present',
      detail:
        `Detected: ${jailbreakIndicators.join(', ')}. A modified system can misreport every other ` +
        'value in this inspection, so all other conclusions are treated as unverified.',
      evidenceIds: [...bundleRecords, ...serviceRecords].map((r) => r.id),
      inferenceIds: inferences.map((i) => i.id),
    });
  }

  // --- Activation Lock ------------------------------------------------------
  const lockRecord =
    ledger.best(EvidenceSubject.SECURITY_STATE, 'IsAssociated') ??
    ledger.best(EvidenceSubject.SECURITY_STATE, 'FMiPAccountExists') ??
    ledger.best(EvidenceSubject.SECURITY_STATE, 'ActivationLockEnabled');
  const activationLockEnabled = lockRecord ? Boolean(lockRecord.value) : null;

  if (lockRecord && activationLockEnabled === true) {
    derive({
      rule: 'security.activation-lock-enabled',
      direction: InferenceDirection.SUPPORTS_NEGATIVE,
      statement: 'Find My reports an associated iCloud account, so Activation Lock is enabled',
      weight: 0.95,
      ruleConfidence: 0.9,
      evidenceIds: [lockRecord.id],
    });
    deduct('ACTIVATION_LOCK', 45, 'Activation Lock is enabled');
    findings.push({
      code: 'SECURITY_ACTIVATION_LOCK_ON',
      basis: FindingBasis.EVIDENCE,
      severity: Severity.CRITICAL,
      module: ModuleId.SECURITY_DNA,
      title: 'Activation Lock is enabled',
      detail:
        'The device is tied to an iCloud account and cannot be resold until the previous owner ' +
        'removes it from Find My.',
      evidenceIds: [lockRecord.id],
      inferenceIds: [],
    });
  } else if (lockRecord) {
    derive({
      rule: 'security.activation-lock-clear',
      direction: InferenceDirection.SUPPORTS_POSITIVE,
      statement: 'Find My reports no associated iCloud account',
      weight: 0.6,
      ruleConfidence: 0.85,
      evidenceIds: [lockRecord.id],
    });
  } else {
    // Not determinable is a real outcome and the most common post-sale dispute,
    // so it is surfaced loudly rather than silently omitted.
    deduct('ACTIVATION_LOCK_UNKNOWN', 10, 'Activation Lock state could not be determined');
    findings.push({
      code: 'SECURITY_ACTIVATION_LOCK_UNKNOWN',
      basis: FindingBasis.ABSENCE,
      severity: Severity.MEDIUM,
      module: ModuleId.SECURITY_DNA,
      title: 'Activation Lock state could not be determined over USB',
      detail:
        'No lockdown domain returned Find My state. Confirm manually in Settings > [name] > Find My ' +
        'before purchase. This is the single most common post-sale dispute in the trade.',
      evidenceIds: [],
      inferenceIds: [],
    });
  }

  // --- Activation state -----------------------------------------------------
  const activationRecord = ledger.best(EvidenceSubject.SECURITY_STATE, 'ActivationState');
  const activationState = activationRecord ? String(activationRecord.value) : null;
  const activated =
    activationState === null ? null : /^(Activated|FactoryActivated|WildcardActivated)$/i.test(activationState);

  if (activationRecord && activated === false) {
    derive({
      rule: 'security.not-activated',
      direction: InferenceDirection.SUPPORTS_NEGATIVE,
      statement: `Device reports activation state ${activationState}`,
      weight: 0.6,
      ruleConfidence: 0.9,
      evidenceIds: [activationRecord.id],
    });
    deduct('NOT_ACTIVATED', 20, `Activation state is ${activationState}`);
  }

  // --- Supervision and MDM --------------------------------------------------
  const supervisedRecord = ledger.best(EvidenceSubject.SECURITY_STATE, 'IsSupervised');
  const mdmRecord =
    ledger.best(EvidenceSubject.SECURITY_STATE, 'IsMDMUnremovable') ??
    ledger.best(EvidenceSubject.SECURITY_STATE, 'ConfigurationURL') ??
    ledger.best(EvidenceSubject.SECURITY_STATE, 'OrganizationName');

  const supervised = supervisedRecord ? Boolean(supervisedRecord.value) : null;
  const mdmEnrolled = mdmRecord ? Boolean(mdmRecord.value) : null;

  if ((supervisedRecord && supervised) || (mdmRecord && mdmEnrolled)) {
    const evidenceIds = [supervisedRecord, mdmRecord]
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => r.id);
    derive({
      rule: 'security.supervised-or-mdm',
      direction: InferenceDirection.SUPPORTS_NEGATIVE,
      statement: 'Device is supervised or enrolled in mobile device management',
      weight: 0.7,
      ruleConfidence: 0.85,
      evidenceIds,
    });
    deduct('MDM_SUPERVISED', 25, 'Device is supervised or MDM-enrolled');
    findings.push({
      code: 'SECURITY_MDM_SUPERVISED',
      basis: FindingBasis.EVIDENCE,
      severity: Severity.HIGH,
      module: ModuleId.SECURITY_DNA,
      title: 'Device is supervised or MDM-enrolled',
      detail:
        'A supervised device can re-enrol into its organisation profile after an erase, which ' +
        'makes it unsellable to a consumer without the organisation releasing it.',
      evidenceIds,
      inferenceIds: [],
    });
  }

  // --- Developer mode -------------------------------------------------------
  const devModeRecord =
    ledger.best(EvidenceSubject.SECURITY_STATE, 'DeveloperModeStatus') ??
    ledger.best(EvidenceSubject.SECURITY_STATE, 'DeveloperMode');
  const developerModeEnabled = devModeRecord ? Boolean(devModeRecord.value) : null;

  if (devModeRecord && developerModeEnabled) {
    derive({
      rule: 'security.developer-mode-enabled',
      direction: InferenceDirection.SUPPORTS_NEGATIVE,
      statement: 'Developer Mode is enabled',
      weight: 0.3,
      ruleConfidence: 0.85,
      evidenceIds: [devModeRecord.id],
    });
    deduct('DEVELOPER_MODE', 5, 'Developer Mode is enabled');
  }

  // --- Passcode -------------------------------------------------------------
  const passcodeRecord = ledger.best(EvidenceSubject.SECURITY_STATE, 'PasswordProtected');
  const passcodeSet = passcodeRecord ? Boolean(passcodeRecord.value) : null;

  // --- Verdict --------------------------------------------------------------
  postureScore = Math.max(0, Math.min(100, postureScore));

  let verdict: Verdict<SecurityVerdict>;
  if (inferences.length === 0) {
    verdict = provenance.conclude<SecurityVerdict>({
      module: ModuleId.SECURITY_DNA,
      subject: EvidenceSubject.SECURITY_STATE,
      value: SecurityVerdict.CANNOT_DETERMINE,
      determinacy: Determinacy.INDETERMINATE,
      confidence: 0,
      rationale: 'No security-relevant state could be read from the device.',
      inferenceIds: [],
    });
  } else {
    const value = integrityCompromised
      ? SecurityVerdict.POSTURE_COMPROMISED
      : postureScore >= 85
        ? SecurityVerdict.POSTURE_CLEAN
        : SecurityVerdict.POSTURE_ATTENTION;

    const negative = massFor(inferences, InferenceDirection.SUPPORTS_NEGATIVE);
    const relevant =
      value === SecurityVerdict.POSTURE_CLEAN ? negative.opposing : negative.supporting;
    const { confidence } = corroborate(relevant.length > 0 ? relevant : inferences, ledger);

    verdict = provenance.conclude<SecurityVerdict>({
      module: ModuleId.SECURITY_DNA,
      subject: EvidenceSubject.SECURITY_STATE,
      value,
      determinacy: Determinacy.DETERMINED,
      confidence: Math.max(confidence, 0.3),
      rationale:
        deductions.length === 0
          ? 'No security or integrity concerns were detected in the readable state.'
          : deductions.map((d) => d.reason).join('; '),
      inferenceIds: (relevant.length > 0 ? relevant : inferences).map((i) => i.id),
    });
  }

  // Coverage: the five posture facts this module tries to establish.
  const available = [
    bundleRecords.length + serviceRecords.length > 0 || ledger.has(readinessProbe(ledger)),
    lockRecord !== undefined,
    activationRecord !== undefined,
    supervisedRecord !== undefined || mdmRecord !== undefined,
    passcodeRecord !== undefined,
  ];
  const coverage = round(available.filter(Boolean).length / available.length);

  const detail: SecurityDetail = {
    postureScore,
    integrityCompromised,
    jailbreakIndicators,
    activationLockEnabled,
    activated,
    supervised,
    mdmEnrolled,
    developerModeEnabled,
    passcodeSet,
    deductions,
  };

  return {
    result: {
      module: ModuleId.SECURITY_DNA,
      verdicts: [verdict],
      inferences,
      coverage,
      confidence: round(clamp01(verdict.confidence * (0.5 + 0.5 * coverage))),
      detail,
    },
    findings,
    detail,
  };
}

/**
 * The integrity probe counts as covered whenever the device answered the
 * service-availability question at all, even when the answer was "no jailbreak
 * services here". A clean negative is a real observation.
 */
function readinessProbe(ledger: EvidenceLedger): string {
  return (
    ledger.best(EvidenceSubject.SECURITY_STATE, 'DiagnosticsRelayResponded')?.id ??
    ledger.best(EvidenceSubject.SECURITY_STATE, 'InstalledAppCount')?.id ??
    ''
  );
}
