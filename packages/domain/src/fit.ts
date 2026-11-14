/**
 * Fit check, version 1: facts only (PLAN.md 3.7). It compares the renter's body
 * measurements with the garment's real flat measurements and says where the hem
 * falls. Verdict labels come later, after the fit experiment passes.
 * All lengths are centimetres.
 */
export interface BodyMeasurements {
  heightCm: number;
  bustCm?: number;
  waistCm?: number;
  hipCm?: number;
}

export interface GarmentMeasurements {
  /** Circumferences of the garment (flat width x 2). */
  bustCm?: number;
  waistCm?: number;
  hipCm?: number;
  /** Extra circumference available from stretch or adjustable closures. */
  stretchCm?: number;
  shoulderToHemCm?: number;
}

export type Point = "bust" | "waist" | "hip";

export interface PointComparison {
  point: Point;
  bodyCm: number;
  garmentCm: number;
  /** Garment minus body; negative means the garment is smaller. */
  easeCm: number;
  /** Ease including stretch or adjustable range. */
  easeWithStretchCm: number;
}

export type HemPosition = "ABOVE_KNEE" | "KNEE" | "MIDI" | "ANKLE" | "FLOOR";

export interface FitFacts {
  points: PointComparison[];
  hem?: { position: HemPosition; cmAboveFloor: number; heelCm: number };
}

/** Shoulder (acromion) height is roughly 82% of standing height; knee about 28%; ankle about 5%. */
const SHOULDER = 0.82;
const KNEE = 0.28;
const ANKLE = 0.05;

export function hemPosition(heightCm: number, shoulderToHemCm: number, heelCm = 0): FitFacts["hem"] {
  const shoulderFromFloor = heightCm * SHOULDER + heelCm;
  const cmAboveFloor = Math.round((shoulderFromFloor - shoulderToHemCm) * 10) / 10;
  const kneeH = heightCm * KNEE + heelCm;
  const ankleH = heightCm * ANKLE + heelCm;
  let position: HemPosition;
  if (cmAboveFloor <= 1) position = "FLOOR";
  else if (cmAboveFloor <= ankleH + 3) position = "ANKLE";
  else if (cmAboveFloor < kneeH - 5) position = "MIDI";
  else if (cmAboveFloor <= kneeH + 5) position = "KNEE";
  else position = "ABOVE_KNEE";
  return { position, cmAboveFloor, heelCm };
}

export function fitFacts(body: BodyMeasurements, garment: GarmentMeasurements, heelCm = 0): FitFacts {
  const points: PointComparison[] = [];
  for (const point of ["bust", "waist", "hip"] as const) {
    const b = body[`${point}Cm`];
    const g = garment[`${point}Cm`];
    if (b == null || g == null) continue;
    const ease = Math.round((g - b) * 10) / 10;
    points.push({
      point,
      bodyCm: b,
      garmentCm: g,
      easeCm: ease,
      easeWithStretchCm: Math.round((ease + (garment.stretchCm ?? 0)) * 10) / 10,
    });
  }
  const facts: FitFacts = { points };
  if (garment.shoulderToHemCm != null) {
    const hem = hemPosition(body.heightCm, garment.shoulderToHemCm, heelCm);
    if (hem) facts.hem = hem;
  }
  return facts;
}

/** Sort key for "closest fit first": the worst negative ease across points (0 if all fit). */
export function fitSortKey(facts: FitFacts): number {
  if (facts.points.length === 0) return Number.NEGATIVE_INFINITY;
  return Math.min(0, ...facts.points.map((p) => p.easeWithStretchCm));
}
