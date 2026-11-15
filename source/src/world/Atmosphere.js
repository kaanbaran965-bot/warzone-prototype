import * as THREE from 'three';

// Replaces three.js' fog with an exponential height fog that has sun in-scattering (warm haze towards the
// sun, cool blue-grey aerial perspective elsewhere). Uses the standard fogColor / fogDensity uniforms of
// FogExp2; the static parameters (sun direction, falloff, scatter colour) are baked into the chunk.
export function installHeightFog({ sunDir, falloff = 0.0042, baseHeight = 0, sunColor = new THREE.Color(1.0, 0.78, 0.5), sunPower = 7.0, sunAmount = 0.75 }) {
  const v3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
  const c3 = (c) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
  const SC = THREE.ShaderChunk;
  SC.fog_pars_vertex = `#ifdef USE_FOG\n varying vec3 vFogWorldPos;\n#endif`;
  SC.fog_vertex = `#ifdef USE_FOG
    // world position from the view-space position (view matrix is rigid): works for every material incl. sprites
    vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
  #endif`;
  SC.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor; uniform float fogDensity; varying vec3 vFogWorldPos;
    vec3 applyHeightFog(vec3 col, vec3 wp) {
      vec3 rd = wp - cameraPosition; float dist = length(rd); rd /= max(dist, 1e-4);
      const float k = ${falloff.toFixed(6)};
      float h0 = max(cameraPosition.y - ${baseHeight.toFixed(2)}, -50.0);
      float ky = k * rd.y * dist;
      float integ = abs(ky) > 1e-4 ? (1.0 - exp(-ky)) / ky : 1.0;
      float amount = fogDensity * exp(-k * h0) * dist * integ;
      float f = 1.0 - exp(-amount);
      float sd = max(dot(rd, ${v3(sunDir)}), 0.0);
      vec3 fc = mix(fogColor, fogColor * ${c3(sunColor)} * 1.6, pow(sd, ${sunPower.toFixed(2)}) * ${sunAmount.toFixed(3)});
      return mix(col, fc, clamp(f, 0.0, 1.0));
    }
  #endif`;
  SC.fog_fragment = `#ifdef USE_FOG
    gl_FragColor.rgb = applyHeightFog(gl_FragColor.rgb, vFogWorldPos);
  #endif`;
}
