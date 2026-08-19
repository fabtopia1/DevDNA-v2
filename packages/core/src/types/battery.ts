import type { DataSource, Finding, MaybeObservation } from './common.js';

export enum BatteryCondition {
  NORMAL = 'NORMAL',
  SERVICE_RECOMMENDED = 'SERVICE_RECOMMENDED',
  DEGRADED = 'DEGRADED',
  UNKNOWN = 'UNKNOWN',
}

export enum ChargingState {
  CHARGING = 'CHARGING',
  DISCHARGING = 'DISCHARGING',
  FULLY_CHARGED = 'FULLY_CHARGED',
  UNKNOWN = 'UNKNOWN',
}

export interface BatteryAssessment {
  /** Apple-equivalent Maximum Capacity, i.e. NominalChargeCapacity / DesignCapacity. */
  maximumCapacityPercent: MaybeObservation<number>;
  cycleCount: MaybeObservation<number>;
  designCapacityMah: MaybeObservation<number>;
  nominalChargeCapacityMah: MaybeObservation<number>;
  /** Current charge level 0-100, not a health metric. */
  currentChargePercent: MaybeObservation<number>;
  chargingState: ChargingState;
  condition: BatteryCondition;
  /** Manufacturer serial of the installed cell, when readable. */
  batterySerial: MaybeObservation<string>;
  /** Rated cycle life for this model family (1000 for iPhone 15 and newer). */
  ratedCycleLife: number;
  /** 0-100 composite battery score. */
  score: number;
  /** 0-1 aggregate confidence in the battery score. */
  confidence: number;
  breakdown: {
    healthComponent: number | null;
    cycleComponent: number | null;
    conditionComponent: number;
    weightsApplied: Record<string, number>;
  };
  findings: Finding[];
  /** Ordered list of sources actually consulted, best first. */
  sourcesUsed: DataSource[];
}
