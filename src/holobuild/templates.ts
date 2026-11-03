/**
 * HOLOBUILD procedural templates — models NEXUS builds itself from basic shapes, with named components, descriptions,
 * assembly steps and facts. They work offline and in the web demo (no AI needed). Each one is a simplified learning
 * model and says so in its caveat; none is an engineering drawing.
 */
import { HoloModelSchema, halfExtent, type HoloModel, type HoloPartInput, type HoloStep } from '../../shared/holo';

type V3 = [number, number, number];
const P = (id: string, name: string, shape: HoloPartInput['shape'], size: V3, position: V3, o: Partial<HoloPartInput> = {}): HoloPartInput => ({ id, name, shape, size, position, ...o });
const DEG = 180 / Math.PI;
/** a cylinder from point a to point b (any direction): rotation maps the cylinder's y axis onto a→b (Euler XYZ, degrees) */
export function segment(id: string, name: string, a: V3, b: V3, dia: number, o: Partial<HoloPartInput> = {}): HoloPartInput {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const len = Math.hypot(...d) || 0.001; const n = d.map((v) => v / len) as V3;
  const rz = -Math.asin(Math.max(-1, Math.min(1, n[0]))); const rx = Math.atan2(n[2], n[1]);
  return P(id, name, 'cylinder', [dia, len, dia], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], { rotation: [rx * DEG, 0, rz * DEG], ...o });
}

export interface Template { id: string; name: string; category: string; keywords: RegExp; build: (prompt: string) => Omit<HoloModel, 'id' | 'prompt' | 'origin' | 'source' | 'createdAt' | 'updatedAt' | 'collection' | 'scale' | 'edits'> }
const model = (name: string, category: string, description: string, caveat: string, parts: HoloPartInput[], steps: HoloStep[], facts: string[], front: HoloModel['front'] = '+z') => ({ name, category, description, caveat, parts, steps, facts, front }) as never;
const step = (title: string, text: string, parts: string[]): HoloStep => ({ title, text, parts });

/* ------------------------------------------------------------------ engine */
const engine: Template = {
  id: 'combustion-engine', name: 'Combustion engine', category: 'mechanical',
  keywords: /\b(combustion|piston|internal[- ]combustion|four[- ]stroke|4[- ]stroke|car|motor)\s*engine\b|\bengine\b|\bmotor block\b/i,
  build: () => model('Single-cylinder combustion engine', 'mechanical',
    'A four-stroke petrol engine with one cylinder: the piston is pushed down by burning fuel, and the connecting rod and crankshaft turn that up-and-down motion into rotation.',
    'Simplified single-cylinder four-stroke engine with approximate proportions — a learning model, not an engineering drawing.',
    [
      P('oil-sump', 'Oil sump', 'box', [0.32, 0.06, 0.24], [0, 0.03, 0], { material: 'cast-iron', group: 'bottom end', description: 'Reservoir at the bottom of the engine that holds the lubricating oil.', explode: [0, -1, 0] }),
      P('crankcase', 'Crankcase', 'box', [0.36, 0.22, 0.28], [0, 0.17, 0], { material: 'cast-iron', group: 'bottom end', shell: true, description: 'Housing that encloses and supports the crankshaft.', explode: [0, -0.6, 0.6] }),
      P('crankshaft', 'Crankshaft', 'cylinder', [0.05, 0.42, 0.05], [0, 0.17, 0], { rotation: [0, 0, 90], material: 'steel', group: 'bottom end', description: 'Rotating shaft that converts the piston’s up-and-down motion into rotation, using the offset crank pin.' }),
      P('crank-web-left', 'Crank web (left)', 'cylinder', [0.16, 0.025, 0.16], [-0.05, 0.17, 0], { rotation: [0, 0, 90], material: 'steel', group: 'bottom end', description: 'Counterweighted arm that holds the crank pin away from the shaft’s axis and balances the rotating mass.' }),
      P('crank-web-right', 'Crank web (right)', 'cylinder', [0.16, 0.025, 0.16], [0.05, 0.17, 0], { rotation: [0, 0, 90], material: 'steel', group: 'bottom end', description: 'Counterweighted arm that holds the crank pin away from the shaft’s axis and balances the rotating mass.' }),
      P('crank-pin', 'Crank pin', 'cylinder', [0.035, 0.09, 0.035], [0, 0.22, 0], { rotation: [0, 0, 90], material: 'chrome', group: 'bottom end', description: 'Offset journal the connecting rod’s big end turns on; its offset (the “throw”) sets the stroke length.' }),
      P('connecting-rod', 'Connecting rod', 'box', [0.03, 0.21, 0.02], [0, 0.325, 0], { material: 'steel', group: 'piston assembly', description: 'Links the piston to the crank pin, carrying the combustion force to the crankshaft.' }),
      P('wrist-pin', 'Wrist pin (gudgeon pin)', 'cylinder', [0.022, 0.09, 0.022], [0, 0.43, 0], { rotation: [0, 0, 90], material: 'chrome', group: 'piston assembly', description: 'Hollow pin that joins the piston to the small end of the connecting rod and lets it pivot.' }),
      P('piston', 'Piston', 'cylinder', [0.1, 0.08, 0.1], [0, 0.445, 0], { material: 'brushed-aluminium', group: 'piston assembly', description: 'Slides up and down inside the cylinder; expanding combustion gas pushes it down on the power stroke.', explode: [0, 1, 0.4] }),
      P('ring-top', 'Compression ring', 'torus', [0.1, 0.006, 0.1], [0, 0.472, 0], { material: 'steel', group: 'piston assembly', description: 'Seals the gap between piston and cylinder wall so combustion pressure is not lost.' }),
      P('ring-oil', 'Oil control ring', 'torus', [0.1, 0.006, 0.1], [0, 0.45, 0], { material: 'steel', group: 'piston assembly', description: 'Scrapes excess oil off the cylinder wall back into the crankcase.' }),
      P('cylinder-block', 'Cylinder block', 'tube', [0.16, 0.26, 0.16], [0, 0.41, 0], { hole: 0.65, material: 'cast-iron', group: 'block', shell: true, description: 'The bore the piston moves in; cooling passages around it carry heat away.', explode: [0, 0.3, -1] }),
      P('cylinder-head', 'Cylinder head', 'box', [0.2, 0.07, 0.2], [0, 0.575, 0], { material: 'brushed-aluminium', group: 'head', shell: true, description: 'Closes the top of the cylinder and forms the combustion chamber; holds the valves and spark plug.', explode: [0, 1, 0] }),
      P('intake-valve', 'Intake valve', 'cylinder', [0.01, 0.1, 0.01], [-0.026, 0.58, 0], { material: 'steel', group: 'valvetrain', description: 'Opens on the intake stroke to let the air–fuel mixture into the cylinder.' }),
      P('intake-valve-head', 'Intake valve head', 'cylinder', [0.035, 0.006, 0.035], [-0.026, 0.533, 0], { material: 'steel', group: 'valvetrain', description: 'Disc that seals against the valve seat when the intake valve is closed.' }),
      P('exhaust-valve', 'Exhaust valve', 'cylinder', [0.01, 0.1, 0.01], [0.026, 0.58, 0], { material: 'steel', group: 'valvetrain', description: 'Opens on the exhaust stroke to let burnt gas leave the cylinder.' }),
      P('exhaust-valve-head', 'Exhaust valve head', 'cylinder', [0.032, 0.006, 0.032], [0.026, 0.533, 0], { material: 'steel', group: 'valvetrain', description: 'Disc that seals against the valve seat when the exhaust valve is closed.' }),
      P('camshaft', 'Camshaft', 'cylinder', [0.025, 0.22, 0.025], [0, 0.645, 0], { rotation: [0, 0, 90], material: 'steel', group: 'valvetrain', description: 'Turns at half crankshaft speed; its lobes push the valves open at the right moments.', explode: [0, 1, 0] }),
      P('cam-lobe-intake', 'Intake cam lobe', 'cylinder', [0.042, 0.016, 0.042], [-0.026, 0.65, 0], { rotation: [0, 0, 90], material: 'steel', group: 'valvetrain', description: 'Egg-shaped bump that opens the intake valve as the camshaft turns.' }),
      P('cam-lobe-exhaust', 'Exhaust cam lobe', 'cylinder', [0.042, 0.016, 0.042], [0.026, 0.64, 0], { rotation: [0, 0, 90], material: 'steel', group: 'valvetrain', description: 'Egg-shaped bump that opens the exhaust valve as the camshaft turns.' }),
      P('spark-plug', 'Spark plug', 'cylinder', [0.014, 0.08, 0.014], [0, 0.62, 0.05], { material: 'ceramic', group: 'ignition', description: 'Makes the spark that ignites the compressed air–fuel mixture near the top of the compression stroke.', explode: [0, 1, 1] }),
      P('intake-port', 'Intake port', 'tube', [0.045, 0.12, 0.045], [-0.15, 0.575, 0], { rotation: [0, 0, 90], hole: 0.7, material: 'brushed-aluminium', group: 'airflow', description: 'Passage that brings the air–fuel mixture to the intake valve.', explode: [-1, 0.3, 0] }),
      P('exhaust-port', 'Exhaust port', 'tube', [0.045, 0.12, 0.045], [0.15, 0.575, 0], { rotation: [0, 0, 90], hole: 0.7, material: 'cast-iron', color: '#6a5a4f', group: 'airflow', description: 'Passage that carries hot exhaust gas away from the exhaust valve.', explode: [1, 0.3, 0] }),
      P('flywheel', 'Flywheel', 'gear', [0.3, 0.03, 0.3], [0.235, 0.17, 0], { rotation: [0, 0, 90], teeth: 48, material: 'cast-iron', group: 'bottom end', description: 'Heavy toothed wheel that smooths out the pulses of the single power stroke; the starter motor engages its teeth.', explode: [1, 0, 0] }),
    ],
    [
      step('Bottom end', 'The crankshaft, with its two counterweighted webs and the offset crank pin, sits in the crankcase above the oil sump.', ['oil-sump', 'crankcase', 'crankshaft', 'crank-web-left', 'crank-web-right', 'crank-pin', 'flywheel']),
      step('Piston assembly', 'The connecting rod’s big end goes on the crank pin; the wrist pin joins its small end to the piston, which carries two rings.', ['connecting-rod', 'wrist-pin', 'piston', 'ring-top', 'ring-oil']),
      step('Cylinder block', 'The block slides down over the piston; the piston now moves inside its bore.', ['cylinder-block']),
      step('Cylinder head and valvetrain', 'The head closes the cylinder. Its intake and exhaust valves are opened by the camshaft lobes.', ['cylinder-head', 'intake-valve', 'intake-valve-head', 'exhaust-valve', 'exhaust-valve-head', 'camshaft', 'cam-lobe-intake', 'cam-lobe-exhaust']),
      step('Ignition and airflow', 'The spark plug screws into the head; intake and exhaust ports carry gas in and out.', ['spark-plug', 'intake-port', 'exhaust-port']),
    ],
    [
      'Four strokes: intake (piston down, intake valve open), compression (both closed), power (spark ignites, piston pushed down), exhaust (exhaust valve open, piston pushes gas out).',
      'One full cycle takes two turns of the crankshaft, so the camshaft turns once per cycle — at half crankshaft speed.',
      'The crank throw is half the stroke: here the crank pin sits about 5 cm off-centre, giving a 10 cm stroke.',
      'Typical petrol engines turn roughly 25–40 % of the fuel’s energy into work; most of the rest leaves as heat.',
    ]),
};

/* ------------------------------------------------------------------ clock */
const clock: Template = {
  id: 'mechanical-clock', name: 'Mechanical clock', category: 'mechanical', keywords: /\bclock|clockwork|gear train|gears?\b|escapement|pendulum/i,
  build: () => model('Pendulum clock movement', 'mechanical',
    'A weight- or spring-driven gear train whose speed is regulated by a pendulum and an anchor escapement; the hands are driven from the centre wheel.',
    'Simplified movement: gear sizes and tooth counts are illustrative, not a working gear ratio set.',
    [
      P('back-plate', 'Back plate', 'box', [0.3, 0.36, 0.01], [0, 0.2, -0.045], { material: 'brass', group: 'frame', shell: true, description: 'Rear plate that holds one end of every arbor (gear axle).', explode: [0, 0, -1] }),
      P('front-plate', 'Front plate', 'box', [0.3, 0.36, 0.01], [0, 0.2, 0.045], { material: 'brass', group: 'frame', shell: true, description: 'Front plate; the gear train runs between the two plates.', explode: [0, 0, 1] }),
      ...([[-0.13, 0.05], [0.13, 0.05], [-0.13, 0.35], [0.13, 0.35]] as const).map(([x, y], i) => P(`pillar-${i + 1}`, `Pillar ${i + 1}`, 'cylinder', [0.012, 0.08, 0.012], [x, y, 0], { rotation: [90, 0, 0], material: 'brass', group: 'frame', description: 'Spacer that holds the two plates the right distance apart.' })),
      P('barrel', 'Mainspring barrel', 'cylinder', [0.09, 0.025, 0.09], [-0.07, 0.1, -0.012], { rotation: [90, 0, 0], material: 'brass', group: 'power', description: 'Drum holding the coiled mainspring that stores the energy driving the clock.' }),
      P('great-wheel', 'Great wheel', 'gear', [0.12, 0.006, 0.12], [-0.07, 0.1, 0.014], { rotation: [90, 0, 0], teeth: 60, material: 'brass', group: 'gear train', description: 'First and largest gear, turned by the barrel; it drives the rest of the train.' }),
      P('centre-wheel', 'Centre wheel', 'gear', [0.09, 0.006, 0.09], [0, 0.18, 0.008], { rotation: [90, 0, 0], teeth: 48, material: 'brass', group: 'gear train', description: 'Turns once an hour and carries the minute hand.' }),
      P('centre-pinion', 'Centre pinion', 'gear', [0.025, 0.012, 0.025], [0, 0.18, -0.006], { rotation: [90, 0, 0], teeth: 8, material: 'steel', group: 'gear train', description: 'Small gear meshing with the great wheel; large-to-small gearing speeds the train up.' }),
      P('third-wheel', 'Third wheel', 'gear', [0.07, 0.006, 0.07], [0.065, 0.25, 0.008], { rotation: [90, 0, 0], teeth: 40, material: 'brass', group: 'gear train', description: 'Intermediate wheel between the centre wheel and the escape wheel.' }),
      P('escape-wheel', 'Escape wheel', 'gear', [0.055, 0.005, 0.055], [0, 0.305, 0.008], { rotation: [90, 0, 0], teeth: 15, material: 'steel', group: 'escapement', description: 'Saw-toothed wheel released one tooth at a time by the anchor — this is what makes the “tick”.' }),
      P('anchor', 'Anchor (pallets)', 'box', [0.07, 0.012, 0.006], [0, 0.335, 0.016], { material: 'steel', group: 'escapement', description: 'Rocks with the pendulum; its two pallets alternately lock and release the escape wheel and give the pendulum a small push.' }),
      P('pendulum-rod', 'Pendulum rod', 'box', [0.006, 0.3, 0.004], [0, 0.19, -0.065], { material: 'steel', group: 'pendulum', description: 'Its length sets the period: about 25 cm swings once a second each way? No — a 0.994 m pendulum beats seconds; this short one beats faster.' }),
      P('pendulum-bob', 'Pendulum bob', 'cylinder', [0.07, 0.012, 0.07], [0, 0.045, -0.065], { rotation: [90, 0, 0], material: 'brass', group: 'pendulum', description: 'Weight at the end of the rod; raising or lowering it adjusts the clock’s rate.' }),
      P('dial', 'Dial', 'cylinder', [0.26, 0.004, 0.26], [0, 0.2, 0.06], { rotation: [90, 0, 0], material: 'ceramic', group: 'face', shell: true, description: 'The clock face with the hour marks.', explode: [0, 0, 1] }),
      P('hour-hand', 'Hour hand', 'box', [0.009, 0.07, 0.002], [0, 0.232, 0.065], { material: 'steel', color: '#15171c', group: 'face', description: 'Driven through reduction gears behind the dial at 1/12 of the minute hand’s speed.', explode: [0, 0.3, 1] }),
      P('minute-hand', 'Minute hand', 'box', [0.006, 0.1, 0.002], [0, 0.248, 0.068], { material: 'steel', color: '#15171c', group: 'face', description: 'Fixed to the centre wheel’s arbor; turns once an hour.', explode: [0, 0.4, 1] }),
    ],
    [
      step('Frame', 'Two plates held apart by four pillars.', ['back-plate', 'front-plate', 'pillar-1', 'pillar-2', 'pillar-3', 'pillar-4']),
      step('Power and gear train', 'The barrel turns the great wheel, which drives the centre pinion and the train above it.', ['barrel', 'great-wheel', 'centre-wheel', 'centre-pinion', 'third-wheel']),
      step('Escapement and pendulum', 'The anchor rocks with the pendulum and releases the escape wheel one tooth per swing.', ['escape-wheel', 'anchor', 'pendulum-rod', 'pendulum-bob']),
      step('Dial and hands', 'The dial goes on the front; the hands sit on the centre arbor.', ['dial', 'hour-hand', 'minute-hand']),
    ],
    ['A pendulum’s period depends mainly on its length: T ≈ 2π√(L/g). A 0.994 m pendulum swings once per second each way (a “seconds pendulum”).', 'The escapement is the regulator: without it the spring would unwind the gears in seconds.', 'The anchor escapement was invented around 1657–1670 and made pendulum clocks accurate to seconds per day.']),
};
// fix the pendulum text (kept honest and short)
clock.build = ((orig) => () => { const m = orig(''); const r = m.parts.find((p: HoloPartInput) => p.id === 'pendulum-rod'); if (r) r.description = 'Its length sets the swing period (T ≈ 2π√(L/g)); this short rod beats faster than once a second.'; return m; })(clock.build);

/* ------------------------------------------------------------------ bridge */
const bridge: Template = {
  id: 'suspension-bridge', name: 'Suspension bridge', category: 'structure', keywords: /\bsuspension bridge|\bbridge\b/i,
  build: () => {
    const parts: HoloPartInput[] = [
      P('deck', 'Deck', 'box', [60, 0.6, 6], [0, 6, 0], { material: 'concrete', group: 'deck', description: 'The roadway, hung from the suspenders; it also stiffens the bridge against wind and traffic loads.' }),
    ];
    for (const [ti, x] of [[1, -18], [2, 18]] as const) {
      for (const z of [-2.6, 2.6]) parts.push(P(`tower-${ti}-leg-${z < 0 ? 'n' : 's'}`, `Tower ${ti} leg (${z < 0 ? 'north' : 'south'})`, 'box', [0.8, 18, 0.8], [x, 9, z], { material: 'steel', color: '#c0392b', group: `tower ${ti}`, description: 'Carries the weight of the main cables straight down into the foundations, mostly in compression.' }));
      parts.push(P(`tower-${ti}-beam`, `Tower ${ti} cross beam`, 'box', [0.8, 0.8, 6], [x, 17, 0], { material: 'steel', color: '#c0392b', group: `tower ${ti}`, description: 'Ties the two tower legs together.' }));
      parts.push(P(`pier-${ti}`, `Pier ${ti}`, 'box', [3, 2, 7.5], [x, 1, 0], { material: 'concrete', group: `tower ${ti}`, description: 'Foundation that spreads the tower load into the ground or river bed.' }));
    }
    const cableY = (x: number) => (Math.abs(x) <= 18 ? 7.5 + (18 - 7.5) * (x / 18) ** 2 : 18 - (18 - 4) * ((Math.abs(x) - 18) / 12));
    for (const z of [-2.8, 2.8]) {
      const side = z < 0 ? 'north' : 'south';
      const xs = [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30];
      for (let i = 0; i < xs.length - 1; i++) parts.push(segment(`cable-${side}-${i + 1}`, `Main cable (${side}) ${i + 1}`, [xs[i], cableY(xs[i]), z], [xs[i + 1], cableY(xs[i + 1]), z], 0.35, { material: 'steel', color: '#5d6672', group: `main cable ${side}`, description: 'Main cable: carries the deck’s weight in tension, from anchorage over both towers to the other anchorage.' }));
      for (let x = -15; x <= 15; x += 3) parts.push(segment(`hanger-${side}-${x + 15}`, `Suspender ${side} at ${x} m`, [x, cableY(x), z], [x, 6.3, z], 0.08, { material: 'steel', color: '#8a919c', group: 'suspenders', description: 'Vertical hanger that hangs the deck from the main cable.' }));
    }
    for (const [i, x] of [[1, -31.5], [2, 31.5]] as const) parts.push(P(`anchorage-${i}`, `Anchorage ${i}`, 'box', [3, 4, 7], [x, 2, 0], { material: 'concrete', group: 'anchorages', description: 'Massive block that holds the cable ends; it resists the cables’ huge horizontal pull.' }));
    return model('Suspension bridge', 'structure', 'A deck hung by vertical suspenders from two main cables, which pass over two towers and are anchored at both ends.', 'Proportions simplified (60 m demonstration span); not a structural design.', parts,
      [step('Foundations and towers', 'Piers carry the towers; anchorages are built at each end.', ['pier-1', 'pier-2', 'tower-1-leg-n', 'tower-1-leg-s', 'tower-1-beam', 'tower-2-leg-n', 'tower-2-leg-s', 'tower-2-beam', 'anchorage-1', 'anchorage-2']),
        step('Main cables', 'Cables are spun over the towers between the anchorages, sagging in a near-parabolic curve.', parts.filter((p) => p.id.startsWith('cable-')).map((p) => p.id)),
        step('Suspenders and deck', 'Hangers are clamped to the cables and the deck sections are lifted and attached.', ['deck', ...parts.filter((p) => p.id.startsWith('hanger-')).map((p) => p.id).slice(0, 38)])],
      ['Under a uniform deck load the main cable takes a parabolic shape; a cable hanging under its own weight alone forms a catenary.', 'The towers are mainly in compression and the cables in tension — steel cable is very strong in tension.', 'The Akashi Kaikyō Bridge in Japan has a main span of 1,991 m (one of the longest).']);
  },
};

/* ------------------------------------------------------------------ robotic arm */
const arm: Template = {
  id: 'robotic-arm', name: 'Robotic arm', category: 'robotics', keywords: /\brobot(ic)?\s*arm|manipulator|arm robot|industrial robot/i,
  build: () => model('Small robotic arm', 'robotics', 'A four-axis arm: a rotating base, shoulder and elbow joints that raise and reach, a wrist, and a two-finger gripper.', 'Illustrative layout; motors, gearboxes and wiring are simplified.',
    [
      P('base', 'Base', 'cylinder', [0.3, 0.06, 0.3], [0, 0.03, 0], { material: 'cast-iron', group: 'base', description: 'Heavy base bolted to the table; keeps the arm from tipping when it reaches out.' }),
      P('turntable', 'Turntable (joint 1)', 'cylinder', [0.24, 0.05, 0.24], [0, 0.085, 0], { material: 'gloss-plastic', color: '#e8892c', group: 'base', description: 'Rotates the whole arm left and right (the “waist” joint).' }),
      P('shoulder', 'Shoulder housing', 'box', [0.14, 0.14, 0.14], [0, 0.18, 0], { material: 'gloss-plastic', color: '#e8892c', group: 'shoulder', description: 'Holds the shoulder motor that lifts the upper arm.' }),
      P('shoulder-motor', 'Shoulder motor', 'cylinder', [0.09, 0.06, 0.09], [0.1, 0.2, 0], { rotation: [0, 0, 90], material: 'steel', group: 'shoulder', description: 'Servo or stepper motor with a gearbox driving joint 2.', explode: [1, 0, 0] }),
      P('upper-arm', 'Upper arm', 'box', [0.08, 0.4, 0.08], [0, 0.45, 0], { material: 'brushed-aluminium', group: 'upper arm', description: 'First link; its length sets how far the arm can reach.' }),
      P('elbow', 'Elbow joint (joint 3)', 'cylinder', [0.1, 0.1, 0.1], [0, 0.67, 0], { rotation: [0, 0, 90], material: 'gloss-plastic', color: '#e8892c', group: 'forearm', description: 'Bends the forearm up and down.' }),
      P('forearm', 'Forearm', 'box', [0.06, 0.06, 0.34], [0, 0.67, 0.2], { material: 'brushed-aluminium', group: 'forearm', description: 'Second link, carrying the wrist and gripper.' }),
      P('wrist', 'Wrist (joint 4)', 'cylinder', [0.065, 0.06, 0.065], [0, 0.67, 0.4], { rotation: [90, 0, 0], material: 'gloss-plastic', color: '#e8892c', group: 'gripper', description: 'Rotates the gripper to line it up with an object.' }),
      P('gripper-base', 'Gripper body', 'box', [0.1, 0.03, 0.04], [0, 0.67, 0.45], { material: 'steel', group: 'gripper', description: 'Holds the finger mechanism.' }),
      P('finger-left', 'Left finger', 'box', [0.015, 0.025, 0.08], [-0.035, 0.67, 0.51], { material: 'rubber', group: 'gripper', description: 'Closes toward the other finger to grip; rubber pads add friction.' }),
      P('finger-right', 'Right finger', 'box', [0.015, 0.025, 0.08], [0.035, 0.67, 0.51], { material: 'rubber', group: 'gripper', description: 'Closes toward the other finger to grip; rubber pads add friction.' }),
    ],
    [step('Base', 'Base and turntable.', ['base', 'turntable']), step('Shoulder and upper arm', 'Shoulder housing, motor and the first link.', ['shoulder', 'shoulder-motor', 'upper-arm']), step('Elbow and forearm', 'Elbow joint and second link.', ['elbow', 'forearm']), step('Wrist and gripper', 'Wrist rotation and the two-finger gripper.', ['wrist', 'gripper-base', 'finger-left', 'finger-right'])],
    ['Each motorised joint adds one degree of freedom; industrial arms usually have six so the gripper can reach any position and orientation.', 'Inverse kinematics is the maths that works out the joint angles needed to put the gripper at a target point.']),
};

/* ------------------------------------------------------------------ motorcycle */
const motorcycle: Template = {
  id: 'motorcycle', name: 'Motorcycle', category: 'vehicle', keywords: /\bmotor\s*(cycle|bike)|motorbike|\bbike\b|scooter/i,
  build: (prompt) => {
    const future = /futur|sci-?fi|cyber|concept/i.test(prompt);
    const body = future ? { material: 'gloss-plastic' as const, color: '#f4f8ff' } : { material: 'gloss-plastic' as const, color: '#c0392b' };
    const wheel = (id: string, name: string, x: number) => [
      P(`${id}-tyre`, `${name} tyre`, 'torus', [0.62, 0.1, 0.62], [x, 0.31, 0], { rotation: [90, 0, 0], material: 'rubber', group: `${id} wheel`, description: 'Rubber tyre: grips the road and absorbs small bumps.' }),
      P(`${id}-rim`, `${name} rim`, 'cylinder', [0.44, 0.06, 0.44], [x, 0.31, 0], { rotation: [90, 0, 0], material: future ? 'carbon-fibre' : 'chrome', group: `${id} wheel`, description: 'Wheel rim that the tyre is mounted on.' }),
      P(`${id}-disc`, `${name} brake disc`, 'cylinder', [0.28, 0.008, 0.28], [x, 0.31, 0.05], { rotation: [90, 0, 0], material: 'steel', group: `${id} wheel`, description: 'Brake disc: the caliper squeezes it to slow the wheel.' }),
    ];
    return model(future ? 'Futuristic motorcycle' : 'Motorcycle', 'vehicle', 'A two-wheeled motor vehicle: engine and fuel tank in the frame, front fork for steering and suspension, swingarm carrying the driven rear wheel.', 'Simplified shapes and proportions — a concept model, not a vehicle design.',
      [
        ...wheel('front', 'Front', 0.72), ...wheel('rear', 'Rear', -0.72),
        P('frame', 'Frame', 'box', [1.0, 0.06, 0.06], [0, 0.62, 0], { rotation: [0, 0, -8], material: 'steel', color: '#2b2f36', group: 'chassis', description: 'Main frame tying the steering head, engine and swingarm pivot together.' }),
        P('tank', 'Fuel tank', 'capsule', [0.26, 0.5, 0.26], [0.18, 0.8, 0], { rotation: [0, 0, 90], ...body, group: 'body', description: 'Holds the fuel above the engine; riders grip it with their knees.' }),
        P('seat', 'Seat', 'box', [0.5, 0.06, 0.24], [-0.27, 0.8, 0], { material: 'rubber', group: 'body', description: 'Rider’s seat over the rear of the frame.' }),
        P('engine', future ? 'Electric motor pack' : 'Engine', 'box', [0.36, 0.3, 0.24], [0.02, 0.45, 0], { material: future ? 'brushed-aluminium' : 'cast-iron', group: 'drivetrain', description: future ? 'Battery and electric motor (assumed electric for the futuristic version).' : 'Engine that drives the rear wheel through a chain.' }),
        ...(future ? [] : [P('exhaust', 'Exhaust pipe', 'cylinder', [0.07, 0.7, 0.07], [-0.36, 0.36, 0.16], { rotation: [0, 0, 80], material: 'chrome', group: 'drivetrain', description: 'Carries exhaust gas from the engine to the back of the bike.' })]),
        P('fork-left', 'Front fork (left leg)', 'cylinder', [0.045, 0.62, 0.045], [0.6, 0.6, -0.06], { rotation: [0, 0, -24], material: 'chrome', group: 'front end', description: 'Telescopic fork leg: steers the front wheel and contains the front suspension.' }),
        P('fork-right', 'Front fork (right leg)', 'cylinder', [0.045, 0.62, 0.045], [0.6, 0.6, 0.06], { rotation: [0, 0, -24], material: 'chrome', group: 'front end', description: 'Telescopic fork leg: steers the front wheel and contains the front suspension.' }),
        P('handlebar', 'Handlebar', 'cylinder', [0.03, 0.62, 0.03], [0.5, 1.0, 0], { rotation: [90, 0, 0], material: 'steel', group: 'front end', description: 'Steering bar with the throttle and brake levers.' }),
        P('headlight', 'Headlight', 'cylinder', [0.13, 0.06, 0.13], [0.72, 0.88, 0], { rotation: [0, 0, 90], material: 'emissive', color: future ? '#38d9ff' : '#ffe9a8', group: 'front end', description: 'Front light.' }),
        P('swingarm', 'Swingarm', 'box', [0.62, 0.05, 0.06], [-0.4, 0.34, 0], { rotation: [0, 0, -3], material: 'brushed-aluminium', group: 'chassis', description: 'Pivoting arm that holds the rear wheel and lets it move up and down with the rear shock.' }),
        P('rear-shock', 'Rear shock absorber', 'cylinder', [0.05, 0.32, 0.05], [-0.3, 0.55, 0], { rotation: [0, 0, 30], material: 'gloss-plastic', color: '#e8c93a', group: 'chassis', description: 'Spring and damper between frame and swingarm.' }),
        P('tail-light', 'Tail light', 'box', [0.04, 0.04, 0.14], [-0.55, 0.82, 0], { material: 'emissive', color: '#ff3b3b', group: 'body', description: 'Rear and brake light.' }),
      ],
      [step('Chassis', 'Frame, swingarm and rear shock.', ['frame', 'swingarm', 'rear-shock']), step('Drivetrain', 'The engine (or motor) bolts into the frame.', ['engine']), step('Wheels', 'Wheels with tyres and brake discs.', ['front-tyre', 'front-rim', 'front-disc', 'rear-tyre', 'rear-rim', 'rear-disc']), step('Front end and body', 'Fork, handlebar, lights, tank and seat.', ['fork-left', 'fork-right', 'handlebar', 'headlight', 'tank', 'seat', 'tail-light'])],
      ['The fork’s angle (“rake”) and trail make a motorcycle self-stabilising at speed.', 'Motorcycles steer at speed by counter-steering: a brief push on the bar the opposite way leans the bike into the turn.'], '+x');
  },
};

/* ------------------------------------------------------------------ heart */
const heart: Template = {
  id: 'human-heart', name: 'Human heart (schematic)', category: 'biology', keywords: /\bheart\b|cardiac/i,
  build: () => model('Human heart (schematic)', 'biology', 'The heart’s four chambers (two atria above two ventricles), its four valves and the great vessels that carry blood in and out.',
    'Schematic only: chambers are drawn as rounded shapes in roughly the right places — not anatomically accurate shapes, sizes or positions. Not for medical use.',
    [
      P('pericardium', 'Pericardium (outer sac)', 'sphere', [0.12, 0.15, 0.11], [0, 0.085, 0], { material: 'tissue', color: '#d9a3a3', opacity: 1, shell: true, group: 'outer', description: 'Fibrous sac around the heart; x-ray it to see the chambers.', explode: [0, 0, 1] }),
      P('right-atrium', 'Right atrium', 'sphere', [0.045, 0.045, 0.04], [-0.028, 0.118, 0.005], { material: 'tissue', color: '#5a6fb0', group: 'right heart', description: 'Receives oxygen-poor blood from the body through the venae cavae.' }),
      P('right-ventricle', 'Right ventricle', 'sphere', [0.055, 0.07, 0.05], [-0.022, 0.06, 0.012], { material: 'tissue', color: '#4a5fa0', group: 'right heart', description: 'Pumps oxygen-poor blood to the lungs through the pulmonary artery.' }),
      P('left-atrium', 'Left atrium', 'sphere', [0.045, 0.04, 0.04], [0.025, 0.12, -0.012], { material: 'tissue', color: '#c84a4a', group: 'left heart', description: 'Receives oxygen-rich blood from the lungs through the pulmonary veins.' }),
      P('left-ventricle', 'Left ventricle', 'sphere', [0.06, 0.085, 0.06], [0.018, 0.058, -0.004], { material: 'tissue', color: '#b03a3a', group: 'left heart', description: 'The strongest chamber: pumps oxygen-rich blood to the whole body through the aorta.' }),
      P('tricuspid-valve', 'Tricuspid valve', 'torus', [0.022, 0.004, 0.022], [-0.026, 0.093, 0.008], { rotation: [90, 0, 0], material: 'ceramic', color: '#f0e0c0', group: 'valves', description: 'Between right atrium and right ventricle; stops blood flowing back.' }),
      P('mitral-valve', 'Mitral valve', 'torus', [0.022, 0.004, 0.022], [0.022, 0.097, -0.008], { rotation: [90, 0, 0], material: 'ceramic', color: '#f0e0c0', group: 'valves', description: 'Between left atrium and left ventricle (two leaflets).' }),
      P('aortic-valve', 'Aortic valve', 'torus', [0.018, 0.004, 0.018], [0.006, 0.105, 0.004], { rotation: [90, 0, 0], material: 'ceramic', color: '#f0e0c0', group: 'valves', description: 'At the exit of the left ventricle into the aorta.' }),
      P('pulmonary-valve', 'Pulmonary valve', 'torus', [0.018, 0.004, 0.018], [-0.012, 0.11, 0.02], { rotation: [90, 0, 0], material: 'ceramic', color: '#f0e0c0', group: 'valves', description: 'At the exit of the right ventricle into the pulmonary artery.' }),
      segment('aorta', 'Aorta', [0.006, 0.108, 0.004], [0.004, 0.17, 0.0], 0.025, { material: 'tissue', color: '#c84a4a', group: 'vessels', description: 'The body’s main artery; arches over and carries blood from the left ventricle to the body.' }),
      segment('aortic-arch', 'Aortic arch', [0.004, 0.17, 0.0], [0.03, 0.165, -0.025], 0.023, { material: 'tissue', color: '#c84a4a', group: 'vessels', description: 'The arch of the aorta, from which arteries to the head and arms branch.' }),
      segment('pulmonary-artery', 'Pulmonary artery', [-0.012, 0.112, 0.02], [-0.03, 0.155, 0.012], 0.021, { material: 'tissue', color: '#5a6fb0', group: 'vessels', description: 'Carries oxygen-poor blood from the right ventricle to the lungs.' }),
      segment('superior-vena-cava', 'Superior vena cava', [-0.036, 0.13, 0.0], [-0.038, 0.18, -0.005], 0.019, { material: 'tissue', color: '#4a5fa0', group: 'vessels', description: 'Brings oxygen-poor blood from the upper body into the right atrium.' }),
      segment('inferior-vena-cava', 'Inferior vena cava', [-0.034, 0.1, -0.005], [-0.04, 0.03, -0.012], 0.02, { material: 'tissue', color: '#4a5fa0', group: 'vessels', description: 'Brings oxygen-poor blood from the lower body into the right atrium.' }),
    ],
    [step('Chambers', 'Two atria above two ventricles; the left side is stronger.', ['right-atrium', 'right-ventricle', 'left-atrium', 'left-ventricle']), step('Valves', 'Four one-way valves keep blood moving forward.', ['tricuspid-valve', 'mitral-valve', 'aortic-valve', 'pulmonary-valve']), step('Great vessels', 'Veins bring blood in; arteries carry it out.', ['aorta', 'aortic-arch', 'pulmonary-artery', 'superior-vena-cava', 'inferior-vena-cava']), step('Pericardium', 'The sac around the heart.', ['pericardium'])],
    ['Blood path: body → venae cavae → right atrium → right ventricle → lungs → left atrium → left ventricle → aorta → body.', 'An adult heart at rest typically beats about 60–100 times a minute.']),
};

/* ------------------------------------------------------------------ house, furniture */
const house: Template = {
  id: 'house', name: 'House', category: 'architecture', keywords: /\b(house|home|cottage|cabin|building|bungalow)\b/i,
  build: () => model('Small house', 'architecture', 'A one-storey house: concrete foundation, four walls with a door and windows, a pitched roof and a chimney.', 'Simplified massing model — no structure, insulation or services; gable ends left open.',
    [
      P('foundation', 'Foundation', 'box', [6.4, 0.3, 5.4], [0, 0.15, 0], { material: 'concrete', group: 'foundation', description: 'Concrete slab that spreads the house’s weight into the ground.' }),
      P('floor', 'Ground floor', 'box', [5.8, 0.1, 4.8], [0, 0.35, 0], { material: 'wood', group: 'interior', description: 'Floor inside the walls.' }),
      P('wall-front', 'Front wall', 'box', [6, 2.8, 0.2], [0, 1.7, 2.5], { material: 'ceramic', color: '#e9e2d4', shell: true, group: 'walls', description: 'Front wall with the door and windows.', explode: [0, 0, 1] }),
      P('wall-back', 'Back wall', 'box', [6, 2.8, 0.2], [0, 1.7, -2.5], { material: 'ceramic', color: '#e9e2d4', shell: true, group: 'walls', description: 'Back wall.', explode: [0, 0, -1] }),
      P('wall-left', 'Left wall', 'box', [0.2, 2.8, 5], [-3, 1.7, 0], { material: 'ceramic', color: '#e9e2d4', shell: true, group: 'walls', description: 'Left side wall.', explode: [-1, 0, 0] }),
      P('wall-right', 'Right wall', 'box', [0.2, 2.8, 5], [3, 1.7, 0], { material: 'ceramic', color: '#e9e2d4', shell: true, group: 'walls', description: 'Right side wall.', explode: [1, 0, 0] }),
      P('roof-front', 'Roof (front slope)', 'box', [6.6, 0.15, 3.4], [0, 4.06, 1.375], { rotation: [35, 0, 0], material: 'concrete', color: '#7a3b2e', shell: true, group: 'roof', description: 'Pitched roof slope; the angle sheds rain and snow.', explode: [0, 1, 0.4] }),
      P('roof-back', 'Roof (back slope)', 'box', [6.6, 0.15, 3.4], [0, 4.06, -1.375], { rotation: [-35, 0, 0], material: 'concrete', color: '#7a3b2e', shell: true, group: 'roof', description: 'Pitched roof slope; the angle sheds rain and snow.', explode: [0, 1, -0.4] }),
      P('door', 'Front door', 'box', [1, 2, 0.08], [0, 1.3, 2.62], { material: 'wood', group: 'openings', description: 'Entrance door.' }),
      P('window-left', 'Left window', 'box', [1.1, 1, 0.06], [-1.8, 1.9, 2.62], { material: 'glass', group: 'openings', description: 'Window: lets in daylight.' }),
      P('window-right', 'Right window', 'box', [1.1, 1, 0.06], [1.8, 1.9, 2.62], { material: 'glass', group: 'openings', description: 'Window: lets in daylight.' }),
      P('chimney', 'Chimney', 'box', [0.6, 1.6, 0.6], [1.8, 4.4, -1], { material: 'concrete', color: '#8a4b3a', group: 'roof', description: 'Carries smoke from a fireplace or stove out above the roof.', explode: [0, 1, 0] }),
      P('interior-wall', 'Interior wall', 'box', [0.12, 2.6, 4.8], [0.8, 1.7, 0], { material: 'ceramic', color: '#f4efe6', group: 'interior', description: 'Divides the inside into two rooms.' }),
    ],
    [step('Foundation', 'Pour the foundation slab and lay the floor.', ['foundation', 'floor']), step('Walls', 'Raise the four outer walls and the interior wall.', ['wall-front', 'wall-back', 'wall-left', 'wall-right', 'interior-wall']), step('Openings', 'Fit the door and windows.', ['door', 'window-left', 'window-right']), step('Roof', 'Add the two roof slopes and the chimney.', ['roof-front', 'roof-back', 'chimney'])],
    ['A 35° roof pitch is common in rainy and snowy climates; flatter roofs need more careful waterproofing.']),
};
const chair: Template = {
  id: 'chair', name: 'Chair', category: 'furniture', keywords: /\bchair|stool\b/i,
  build: () => model('Wooden chair', 'furniture', 'A four-legged chair with a seat and backrest.', 'Typical dimensions; joinery not modelled.',
    [P('seat', 'Seat', 'box', [0.45, 0.04, 0.45], [0, 0.45, 0], { material: 'wood', description: 'Seat about 45 cm high — a common height for dining chairs.' }),
      ...([[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]] as const).map(([x, z], i) => P(`leg-${i + 1}`, `Leg ${i + 1}`, 'cylinder', [0.04, 0.43, 0.04], [x, 0.215, z], { material: 'wood', group: 'legs', description: 'Leg carrying the seat load to the floor.' })),
      P('backrest', 'Backrest', 'box', [0.45, 0.42, 0.03], [0, 0.71, -0.21], { rotation: [-6, 0, 0], material: 'wood', description: 'Back support, tilted back slightly for comfort.' })],
    [step('Legs and seat', 'Fix the four legs under the seat.', ['seat', 'leg-1', 'leg-2', 'leg-3', 'leg-4']), step('Backrest', 'Attach the backrest.', ['backrest'])], []),
};
const table: Template = {
  id: 'table', name: 'Table', category: 'furniture', keywords: /\btable|desk\b/i,
  build: () => model('Table', 'furniture', 'A rectangular table: top and four legs.', 'Typical dimensions; joinery not modelled.',
    [P('top', 'Table top', 'box', [1.2, 0.04, 0.7], [0, 0.74, 0], { material: 'wood', description: 'Table top about 74 cm high — a common working height.' }),
      ...([[-0.54, -0.29], [0.54, -0.29], [-0.54, 0.29], [0.54, 0.29]] as const).map(([x, z], i) => P(`leg-${i + 1}`, `Leg ${i + 1}`, 'box', [0.06, 0.72, 0.06], [x, 0.36, z], { material: 'wood', group: 'legs', description: 'Leg carrying the load to the floor.' }))],
    [step('Assembly', 'Fix the legs under the top.', ['top', 'leg-1', 'leg-2', 'leg-3', 'leg-4'])], []),
};

/* ------------------------------------------------------------------ molecules */
const atom = (id: string, name: string, el: 'O' | 'H' | 'C', p: V3, desc: string) => P(id, name, 'sphere', el === 'H' ? [0.62, 0.62, 0.62] : [1.1, 1.1, 1.1], p, { material: 'gloss-plastic', color: el === 'O' ? '#d63b3b' : el === 'H' ? '#f4f8ff' : '#2b2f36', group: el === 'H' ? 'hydrogen' : el === 'O' ? 'oxygen' : 'carbon', description: desc });
const molecule: Template = {
  id: 'molecule', name: 'Molecule', category: 'chemistry', keywords: /\bmolecule|h2o|water molecule|co2|carbon dioxide|methane|ch4\b/i,
  build: (prompt) => {
    const scale = 'Ball-and-stick model; 1 viewer metre = 1 ångström (10⁻¹⁰ m). Atom sizes are reduced so the bonds stay visible.';
    if (/co2|carbon dioxide/i.test(prompt)) {
      const c: V3 = [0, 1, 0];
      return model('Carbon dioxide (CO₂)', 'chemistry', 'A linear molecule: one carbon atom double-bonded to two oxygen atoms (180° apart).', scale,
        [atom('carbon', 'Carbon atom', 'C', c, 'Central atom; forms a double bond with each oxygen.'), atom('oxygen-1', 'Oxygen atom 1', 'O', [-1.16, 1, 0], 'Double-bonded to carbon (C=O bond length ≈ 1.16 Å).'), atom('oxygen-2', 'Oxygen atom 2', 'O', [1.16, 1, 0], 'Double-bonded to carbon (C=O bond length ≈ 1.16 Å).'),
          ...[-1, 1].flatMap((s) => [-0.09, 0.09].map((z, k) => segment(`bond-${s < 0 ? 1 : 2}-${k + 1}`, `C=O bond ${s < 0 ? 1 : 2} (${k ? 'π' : 'σ'})`, [0, 1, z], [s * 1.16, 1, z], 0.1, { material: 'ceramic', group: 'bonds', description: 'One of the two bonds of a C=O double bond.' })))],
        [], ['CO₂ is linear (bond angle 180°), so its two bond dipoles cancel and the molecule is non-polar.']);
    }
    if (/methane|ch4/i.test(prompt)) {
      const c: V3 = [0, 1.2, 0]; const dirs: V3[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
      const hs = dirs.map((d) => d.map((v, i) => c[i] + (v / Math.sqrt(3)) * 1.09) as V3);
      return model('Methane (CH₄)', 'chemistry', 'A carbon atom with four hydrogen atoms at the corners of a tetrahedron.', scale,
        [atom('carbon', 'Carbon atom', 'C', c, 'Central atom with four single bonds.'), ...hs.map((h, i) => atom(`hydrogen-${i + 1}`, `Hydrogen atom ${i + 1}`, 'H', h, 'Single-bonded to carbon (C–H ≈ 1.09 Å).')),
          ...hs.map((h, i) => segment(`bond-${i + 1}`, `C–H bond ${i + 1}`, c, h, 0.12, { material: 'ceramic', group: 'bonds', description: 'Single covalent bond.' }))],
        [], ['The H–C–H angle is about 109.5°, the tetrahedral angle.']);
    }
    const o: V3 = [0, 1, 0]; const a = (104.5 / 2) * (Math.PI / 180);
    const h1: V3 = [-0.96 * Math.sin(a), 1 - 0.96 * Math.cos(a), 0], h2: V3 = [0.96 * Math.sin(a), 1 - 0.96 * Math.cos(a), 0];
    return model('Water molecule (H₂O)', 'chemistry', 'One oxygen atom bonded to two hydrogen atoms in a bent shape.', scale,
      [atom('oxygen', 'Oxygen atom', 'O', o, 'Pulls shared electrons toward itself, making the molecule polar.'), atom('hydrogen-1', 'Hydrogen atom 1', 'H', h1, 'Single-bonded to oxygen (O–H ≈ 0.96 Å).'), atom('hydrogen-2', 'Hydrogen atom 2', 'H', h2, 'Single-bonded to oxygen (O–H ≈ 0.96 Å).'),
        segment('bond-1', 'O–H bond 1', o, h1, 0.12, { material: 'ceramic', group: 'bonds', description: 'Polar covalent bond.' }), segment('bond-2', 'O–H bond 2', o, h2, 0.12, { material: 'ceramic', group: 'bonds', description: 'Polar covalent bond.' })],
      [], ['The H–O–H angle is about 104.5°: two lone pairs on oxygen push the bonds closer than the tetrahedral 109.5°.', 'Because the molecule is bent and polar, water molecules form hydrogen bonds — which gives water its high boiling point.']);
  },
};

/* ------------------------------------------------------------------ solar system */
const solar: Template = {
  id: 'solar-system', name: 'Solar system', category: 'astronomy', keywords: /\bsolar system|planets\b/i,
  build: () => {
    const planets: [string, number, number, string, string][] = [
      ['Mercury', 3, 0.2, '#9e9a94', 'Smallest planet and closest to the Sun; a year lasts 88 Earth days.'], ['Venus', 4.2, 0.36, '#e3c48a', 'Hottest planet: its thick CO₂ atmosphere traps heat.'],
      ['Earth', 5.5, 0.38, '#3a7bd5', 'The only planet known to have life; liquid water covers about 71 % of its surface.'], ['Mars', 6.8, 0.27, '#c1502e', 'The red planet: iron oxide dust gives it its colour.'],
      ['Jupiter', 9.2, 1.0, '#d9b38c', 'Largest planet, a gas giant more than 300 times Earth’s mass.'], ['Saturn', 12, 0.85, '#e8d5a0', 'Gas giant famous for its bright ice rings.'],
      ['Uranus', 14.6, 0.55, '#9fe0e8', 'Ice giant tilted on its side (axial tilt about 98°).'], ['Neptune', 16.8, 0.53, '#3f66d6', 'Farthest planet, with the fastest winds measured in the Solar System.'],
    ];
    const parts: HoloPartInput[] = [P('sun', 'Sun', 'sphere', [2, 2, 2], [0, 1.2, 0], { material: 'emissive', color: '#ffc94a', description: 'The star at the centre: about 99.8 % of the Solar System’s mass.' })];
    planets.forEach(([n, r, d, c, desc], i) => {
      const ang = (i * 47 * Math.PI) / 180; const id = n.toLowerCase();
      parts.push(P(id, n, 'sphere', [d, d, d], [Math.cos(ang) * r, 1.2, Math.sin(ang) * r], { material: 'plastic', color: c, group: 'planets', description: desc, explode: [0, 1, 0] }));
      parts.push(P(`${id}-orbit`, `${n}’s orbit`, 'torus', [r * 2, 0.02, r * 2], [0, 1.2, 0], { material: 'ceramic', color: '#5d6b80', opacity: 0.6, group: 'orbits', description: `Orbit of ${n} (drawn as a circle; real orbits are slightly elliptical).` }));
    });
    const sat = parts.find((p) => p.id === 'saturn')!;
    parts.push(P('saturn-rings', 'Saturn’s rings', 'torus', [1.6, 0.06, 1.6], sat.position as V3, { rotation: [27, 0, 0], material: 'ceramic', color: '#d9c79a', group: 'planets', description: 'Rings of ice and rock particles, mostly centimetres to metres across.' }));
    return model('Solar system', 'astronomy', 'The Sun and the eight planets on their orbits.', 'Not to scale: real distances are vastly larger relative to the planets (Neptune is about 30 times farther from the Sun than Earth).', parts,
      [step('The Sun', 'The Sun sits at the centre.', ['sun']), step('Inner planets', 'Rocky planets.', ['mercury', 'venus', 'earth', 'mars']), step('Outer planets', 'Gas and ice giants.', ['jupiter', 'saturn', 'saturn-rings', 'uranus', 'neptune'])],
      ['Light from the Sun takes about 8 minutes 20 seconds to reach Earth.', 'One astronomical unit (Earth–Sun distance) is about 150 million km.']);
  },
};

/* ------------------------------------------------------------------ rocket */
const rocket: Template = {
  id: 'rocket', name: 'Rocket', category: 'aerospace', keywords: /\brocket|launch vehicle|spaceship\b/i,
  build: () => model('Two-stage rocket', 'aerospace', 'A two-stage liquid-fuel rocket: the first stage lifts off and falls away; the second stage carries the payload under the nose fairing.', 'Simplified external shape; tanks and engines are schematic.',
    [
      P('first-stage', 'First stage', 'cylinder', [0.7, 3.2, 0.7], [0, 1.9, 0], { material: 'gloss-plastic', color: '#f4f8ff', group: 'first stage', shell: true, description: 'Contains the big fuel and oxidiser tanks; burns for the first minutes of flight, then separates.', explode: [0, -1, 0] }),
      P('first-tank', 'First-stage fuel tank', 'capsule', [0.6, 2.6, 0.6], [0, 1.95, 0], { material: 'brushed-aluminium', group: 'first stage', description: 'Propellant tank inside the first stage.' }),
      P('engine-bell', 'Main engine nozzle', 'cylinder', [0.6, 0.45, 0.6], [0, 0.28, 0], { taper: 0.45, material: 'cast-iron', group: 'first stage', description: 'Bell-shaped nozzle: accelerates the hot exhaust to produce thrust.', explode: [0, -1, 0] }),
      ...[0, 90, 180, 270].map((a, i) => P(`fin-${i + 1}`, `Fin ${i + 1}`, 'box', [0.04, 0.6, 0.45], [Math.sin((a * Math.PI) / 180) * 0.5, 0.65, Math.cos((a * Math.PI) / 180) * 0.5], { rotation: [0, a, 0], material: 'gloss-plastic', color: '#c0392b', group: 'first stage', description: 'Aerodynamic fin that keeps the rocket pointing straight in the lower atmosphere.' })),
      P('interstage', 'Interstage', 'cylinder', [0.7, 0.3, 0.7], [0, 3.65, 0], { material: 'carbon-fibre', group: 'second stage', description: 'Connects the stages; separation bolts fire here.' }),
      P('second-stage', 'Second stage', 'cylinder', [0.6, 1.4, 0.6], [0, 4.5, 0], { material: 'gloss-plastic', color: '#f4f8ff', group: 'second stage', shell: true, description: 'Upper stage with its own engine; finishes the climb to orbit.', explode: [0, 0.6, 1] }),
      P('payload', 'Payload (satellite)', 'box', [0.35, 0.5, 0.35], [0, 5.55, 0], { material: 'gold', group: 'payload', description: 'The satellite or spacecraft being launched.' }),
      P('fairing', 'Nose fairing', 'cone', [0.6, 1.1, 0.6], [0, 5.75, 0], { material: 'gloss-plastic', color: '#f4f8ff', group: 'payload', shell: true, description: 'Protects the payload from air friction; splits open and drops away above the atmosphere.', explode: [0, 1, 0] }),
    ],
    [step('First stage', 'Tank, engine and fins.', ['first-stage', 'first-tank', 'engine-bell', 'fin-1', 'fin-2', 'fin-3', 'fin-4']), step('Second stage', 'Interstage and upper stage.', ['interstage', 'second-stage']), step('Payload', 'Satellite under the fairing.', ['payload', 'fairing'])],
    ['Staging drops empty tank mass so the remaining rocket can accelerate more efficiently (the rocket equation).', 'Low Earth orbit needs about 7.8 km/s of horizontal speed.']),
};

/* ------------------------------------------------------------------ basic shapes */
const SHAPE_WORDS: [RegExp, HoloPartInput['shape'], V3, Partial<HoloPartInput>][] = [
  [/cube|box|block/i, 'box', [1, 1, 1], {}], [/sphere|ball|orb/i, 'sphere', [1, 1, 1], {}], [/cylinder|tube|pipe/i, 'cylinder', [0.8, 1.2, 0.8], {}],
  [/cone|pyramid/i, 'cone', [1, 1.2, 1], {}], [/torus|donut|doughnut|ring/i, 'torus', [1.2, 0.3, 1.2], { rotation: [90, 0, 0] }], [/capsule|pill/i, 'capsule', [0.6, 1.4, 0.6], {}],
  [/gear|cog/i, 'gear', [1, 0.2, 1], { teeth: 20, rotation: [90, 0, 0] }],
];
const basic: Template = {
  id: 'basic-shape', name: 'Basic shape', category: 'shape', keywords: /^(?:an?\s+)?(?:[a-z]+\s+){0,3}(cube|box|block|sphere|ball|orb|cylinder|cone|pyramid|torus|donut|doughnut|ring|capsule|pill|gear|cog)s?$/i,
  build: (prompt) => {
    const hit = SHAPE_WORDS.find(([re]) => re.test(prompt)) ?? SHAPE_WORDS[0]; const [, shape, size, extra] = hit;
    const col = /\b(red|orange|yellow|green|blue|purple|pink|white|black|grey|gray|gold|silver|cyan)\b/i.exec(prompt)?.[1];
    const k = /\b(big|large)\b/i.test(prompt) ? 2 : /\b(small|little|tiny)\b/i.test(prompt) ? 0.5 : 1;
    const name = shape === 'box' ? 'Cube' : shape[0].toUpperCase() + shape.slice(1);
    const sz = size.map((v) => v * k) as V3;
    return model(name, 'shape', `A ${name.toLowerCase()}.`, '', [P(shape, name, shape, sz, [0, halfExtent({ size: sz, rotation: (extra.rotation ?? [0, 0, 0]) as V3 })[1], 0], { material: 'gloss-plastic', ...(col ? { color: ({ red: '#d63b3b', orange: '#e8892c', yellow: '#e8c93a', green: '#3aa65a', blue: '#1268f5', purple: '#7b4ad6', pink: '#e86aa6', white: '#f4f8ff', black: '#15171c', grey: '#8a919c', gray: '#8a919c', gold: '#d9a93a', silver: '#c0c6cf', cyan: '#38d9ff' } as Record<string, string>)[col.toLowerCase()] } : {}), ...extra })], [], []);
  },
};

export const TEMPLATES: Template[] = [basic, engine, clock, bridge, arm, motorcycle, heart, house, chair, table, molecule, solar, rocket];

/** What the person asked to build, stripped of "build me a…" (null if it isn't a build request at all). */
export function buildSubject(text: string): string | null {
  const m = /^(?:hey\s+)?(?:nexus[,:]?\s*)?(?:please\s+|can you\s+|could you\s+)?(?:build|create|make|generate|model|design|show me|construct|draw|render)\s+(?:me\s+|us\s+)?(?:a\s+model\s+of\s+|a\s+3d\s+model\s+of\s+|a\s+3d\s+|a\s+|an\s+|the\s+|some\s+)?(.+?)[.!?]*$/i.exec(text.trim());
  return m ? m[1].trim().replace(/^(model of|3d model of)\s+/i, '') : null;
}
export function matchTemplate(subject: string): Template | null {
  const s = subject.trim();
  if (basic.keywords.test(s)) return basic;
  return TEMPLATES.find((t) => t !== basic && t.keywords.test(s)) ?? null;
}
let seq = 0;
export const newModelId = () => `holo-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Builds a template into a validated model (throws only on a programming error in a template — covered by tests). */
export function buildTemplate(t: Template, prompt: string): HoloModel {
  const now = Date.now();
  return HoloModelSchema.parse({ ...t.build(prompt), id: newModelId(), prompt: prompt.slice(0, 400), origin: 'template', source: t.id, createdAt: now, updatedAt: now });
}
