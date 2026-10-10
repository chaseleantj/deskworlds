import * as THREE from 'three';

// Both scenes render linear HDR color and depth, then composite once to the display.
export function createPostprocessing(camera, { samples = 4, uniforms = {}, fragmentShader }) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const scene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      beauty: { value: target.texture },
      depth: { value: target.depthTexture },
      size: { value: new THREE.Vector2() },
      nearFar: { value: new THREE.Vector2(camera.near, camera.far) },
      aoRadiusScale: { value: 1 },
      ...uniforms,
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return { target, post: material, postScene: scene, postCamera };
}
