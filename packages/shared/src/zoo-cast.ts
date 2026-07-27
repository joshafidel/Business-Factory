/**
 * The "Zoo Friends" show bible. Recurring characters are the backbone of
 * every successful toddler channel (Cocomelon's JJ & family, Nunu TV's cast):
 * kids bond with characters they recognize, which drives repeat views.
 *
 * The `look` string must be injected VERBATIM into every image prompt the
 * character appears in — identical wording is what keeps the character
 * visually consistent from scene to scene and episode to episode.
 *
 * Kept in @bf/shared so the seed (agent prompts) and the renderer (image
 * prompts) use exactly the same descriptions.
 */
export interface ZooCharacter {
  name: string;
  species: string;
  look: string;
  personality: string;
}

export const ZOO_CAST: ZooCharacter[] = [
  {
    name: "Ellie",
    species: "baby elephant",
    look: "Ellie, a chubby adorable baby elephant, soft light-grey skin, huge sparkly blue eyes with long lashes, big floppy pink-inside ears, a tiny pink bow on her head, little happy trunk",
    personality: "curious, kind leader who loves trying new things",
  },
  {
    name: "Milo",
    species: "baby monkey",
    look: "Milo, a tiny cheeky baby monkey, warm light-brown fur, cream face, giant happy grin, big round amber eyes, long curly tail, holding a little yellow banana",
    personality: "silly prankster who makes everyone giggle",
  },
  {
    name: "Gigi",
    species: "baby giraffe",
    look: "Gigi, a gentle baby giraffe, soft butter-yellow coat with round orange spots, long graceful neck, huge brown eyes with long lashes, tiny orange horns with fluffy tips",
    personality: "gentle tall friend who helps everyone reach things",
  },
  {
    name: "Pip",
    species: "baby penguin",
    look: "Pip, a tiny brave baby penguin, glossy black-and-white feathers, chubby round belly, small orange beak and feet, wearing a little red scarf",
    personality: "smallest and bravest, waddles fast, never gives up",
  },
];

/** Verbatim look-lines for the named characters (case-insensitive). */
export function castLooks(names: string[]): string[] {
  const wanted = names.map((n) => n.toLowerCase().trim());
  return ZOO_CAST.filter((c) => wanted.includes(c.name.toLowerCase())).map((c) => c.look);
}

/** One-line cast sheet for prompt templates. */
export function castSheet(): string {
  return ZOO_CAST.map(
    (c) => `- ${c.name} the ${c.species} (${c.personality}). Look: ${c.look}`,
  ).join("\n");
}
