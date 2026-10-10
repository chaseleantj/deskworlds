// Skeleton. The fish is authored in a local frame: +x forward (nose at x=0.5),
// +y up, +z to the fish's right. Everything is skinned onto a chain of joints
// that runs from the nose back through the caudal fin.
export const NJ = 32;          // joints
export const J0 = 0.53;        // local x of joint 0 (nose)
export const JD = 0.058;       // joint spacing
export const PIVOT_X = 0.06;   // local x the fish turns around
export const IP = Math.round((J0 - PIVOT_X) / JD);
