/**
 * The 3D robot's body animation (full-body clips, state loops, presence hooks): one on-demand chunk, loaded by
 * CharacterRuntime.loadBody() when the 3D robot is shown — pages without the 3D robot never download it.
 */
export { BodyController } from './body/controller';
export { gesturingFrom } from './motion3d';
