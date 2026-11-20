// Every world, in gallery order: the gallery and each world's switcher read this list.
// A world lives in scenes/<id>/ and its gallery preview is docs/images/<id>-wide.png.
export const WORLDS = Object.freeze([
  { id: 'riverscape', name: 'Riverbed', alt: 'Fish swimming through green rivergrass and driftwood' },
  { id: 'reefscape', name: 'Coral reef', alt: 'A coral reef with clownfish, anemones and branching corals' },
  { id: 'bettascape', name: 'Betta', alt: 'A halfmoon betta with its long fins spread against a black background' },
  { id: 'plasmascape', name: 'Plasma globe', alt: 'A plasma globe glowing on a walnut desk in a dark room, violet filaments running from its electrode to the glass' },
  { id: 'koiscape', name: 'Koi pond', alt: 'Koi of several colours gliding through dark water under lily pads, seen from above' },
  { id: 'bonfirescape', name: 'Bonfire', alt: 'A bonfire burning in the dark, a coiled sword driven into its charred logs and sparks rising' },
  { id: 'lakescape', name: 'Lake storm', alt: 'A rain-streaked cabin window at night: a porch rail hung with warm lights, two chairs by a fire pit on the beach, and lightning over a mountain lake' },
  { id: 'blossomscape', name: 'Cherry blossom', alt: 'An old cherry tree in blossom on a rocky islet in a still lake at night, small under a sky of star trails wheeling about a bright pole star, its petals drifting on the water' },
]);

const root = new URL('../', import.meta.url);
export const worldUrl = world => new URL(`scenes/${world.id}/`, root);
export const previewUrl = world => new URL(`docs/images/${world.id}-wide.png`, root);
export const currentWorld = () => WORLDS.find(world => location.pathname.startsWith(worldUrl(world).pathname));
