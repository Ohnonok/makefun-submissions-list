export const FACTIONS = {
SOLARIS: {
nm: 'SOLARIS VANGUARD', short: 'SOLARIS', side: 'Solar-Gold',
color: '#f4a261', creed: 'Hold the Conduit. Burn bright, stand fast.',
operatives: ['Nova', 'Helix', 'Orion', 'Vega'],
}, ECLIPSE: {
nm: 'ECLIPSE SYNDICATE', short: 'ECLIPSE', side: 'Void-Violet',
color: '#7b2fbe', creed: 'The dark between stars is ours to take.',
operatives: ['Shade', 'Umbra', 'Null', 'Hex', 'Vex', 'Noct'],
},
};
export const CONDUIT = {
nm: 'Astral Conduit', si: 'Solaris Dome', x: -22, z: 0,
desc: 'The living star-heart beneath the Golden Telescope Dome. Whoever holds the Conduit holds the Observatory — and the sky above it.',
};
export const MECHANIC_LORE = {
polarity: {
key: 'Q', nm: 'Polarity Shift',
desc: 'Attune rounds to Solar-Gold or Void-Violet. Opposite visors shatter; the Prism Core drinks matching light.',
}, venting: {
key: 'R', nm: 'Active Heat Venting',
desc: 'Dump weapon heat through the vent ports before the coils lock. Hot guns win fights; cool guns win rounds.',
}, refraction: {
key: null, nm: 'Crystal Pylon Refraction',
desc: 'Rifle and rail fire bent through Astral Crystal Pylons splits into three beams that hunt behind cover.',
}, override: {
key: 'F', nm: 'Neural Drone Override',
desc: 'Hijack a Sentinel Drone within 25 units and line of sight. Twelve seconds of borrowed eyes.',
},
};
