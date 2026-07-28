import { type PhotoInfo } from "./types";

/**
 * Smart sequencing: recommends a coherent tour order from room labels and
 * categories. Photos it can't classify keep their relative manual order and
 * slot between the classified groups. The recommendation never claims rooms
 * connect — it only orders shots.
 */

/** Tour position by room label (lower = earlier). Unknown labels use their
 *  category's position; unlabeled interiors sit in the middle of the tour. */
const LABEL_ORDER: Record<string, number> = {
  Exterior: 10,
  Entry: 20,
  Foyer: 21,
  "Living room": 30,
  "Dining room": 40,
  Kitchen: 50,
  "Primary bedroom": 60,
  Bathroom: 75,
  Bedroom: 70,
  Office: 80,
  Laundry: 85,
  Basement: 88,
  Garage: 90,
  Patio: 92,
  Balcony: 93,
  Backyard: 94,
  Pool: 95,
  Gym: 96,
  "Building amenities": 97,
  Neighborhood: 98,
  "Floor plan": 99,
};

const CATEGORY_ORDER: Record<string, number> = {
  exterior: 10,
  aerial: 12,
  interior: 55,
  amenity: 96,
  neighborhood: 98,
  floor_plan: 99,
  branding: 100,
};

function tourPosition(photo: PhotoInfo): number {
  if (photo.roomLabel && LABEL_ORDER[photo.roomLabel] !== undefined) {
    return LABEL_ORDER[photo.roomLabel]!;
  }
  return CATEGORY_ORDER[photo.category] ?? 55;
}

/**
 * Returns photo ids in recommended order:
 * hero exterior first, then the classic tour flow, ending with outdoor
 * space, amenities, neighborhood, and floor plan. Stable within groups so
 * the user's manual order breaks ties.
 */
export function recommendOrder(photos: PhotoInfo[]): string[] {
  const included = photos.filter((p) => !p.isExcluded).sort((a, b) => a.order - b.order);
  const ranked = included
    .map((p, manualIndex) => ({ p, manualIndex, pos: tourPosition(p) }))
    .sort((a, b) => a.pos - b.pos || a.manualIndex - b.manualIndex);

  const ordered = ranked.map((r) => r.p);
  // Closing hero: when there are 4+ shots and at least two exteriors, move
  // the last exterior to the end as the final beauty shot.
  if (ordered.length >= 4) {
    const exteriors = ordered.filter((p) => tourPosition(p) <= 12);
    if (exteriors.length >= 2) {
      const closer = exteriors[exteriors.length - 1]!;
      const rest = ordered.filter((p) => p.id !== closer.id);
      // Keep floor plans truly last if present.
      const floorPlanAt = rest.findIndex((p) => (CATEGORY_ORDER[p.category] ?? 0) >= 99);
      if (floorPlanAt === -1) rest.push(closer);
      else rest.splice(floorPlanAt, 0, closer);
      return rest.map((p) => p.id);
    }
  }
  return ordered.map((p) => p.id);
}
