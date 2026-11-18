// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Direct lighting from the grid, in the view-space frame three.js uses. */
export const LAMP_HEAD = /* glsl */ `
uniform vec3 uLampMin;
uniform ivec3 uLampDims;
uniform float uLampCellSize;
uniform ivec3 uLampOffsets;
vec4 lampTexel(int offset) {
  int width = int(uBakedSize.x);
  return texelFetch(uBakedIrr, ivec2(offset % width, offset / width), 0);
}`

export const LAMP_APPLY = /* glsl */ `
#if defined( RE_Direct )
if (uBakedOn > 0.5) {
  ivec3 lampCell = ivec3(floor((vBakedWorld - uLampMin) / uLampCellSize));
  if (all(greaterThanEqual(lampCell, ivec3(0))) && all(lessThan(lampCell, uLampDims))) {
    int lampCellIndex = lampCell.x + uLampDims.x * (lampCell.y + uLampDims.y * lampCell.z);
    vec4 lampEntry = lampTexel(uLampOffsets.x + lampCellIndex);
    int lampStart = int(lampEntry.x);
    int lampCount = int(lampEntry.y);
    for (int lampI = 0; lampI < 32; lampI++) {
      if (lampI >= lampCount) break;
      int lampIndexOffset = lampStart + lampI;
      vec4 lampIndices = lampTexel(uLampOffsets.y + lampIndexOffset / 4);
      // The component by a mask, not lampIndices[i]: Direct3D's compiler under ANGLE reads a
      // vec4 indexed at run time as "potentially uninitialized" (warning X4000, every lit program).
      int lampIndex = int(dot(lampIndices, vec4(equal(ivec4(lampIndexOffset % 4), ivec4(0, 1, 2, 3)))));
      vec4 lampPosition = lampTexel(uLampOffsets.z + lampIndex * 3);
      vec4 lampColor = lampTexel(uLampOffsets.z + lampIndex * 3 + 1);
      vec4 lampDirection = lampTexel(uLampOffsets.z + lampIndex * 3 + 2);
      vec3 lampVector = (viewMatrix * vec4(lampPosition.xyz, 1.0)).xyz - geometryPosition;
      float lampDistance = length(lampVector);
      IncidentLight clusteredLamp;
      clusteredLamp.direction = normalize(lampVector);
      float lampSpot = 1.0;
      if (lampColor.w > -1.5) {
        vec3 lampAxis = normalize(mat3(viewMatrix) * lampDirection.xyz);
        lampSpot = getSpotAttenuation(lampColor.w, lampDirection.w, dot(-clusteredLamp.direction, lampAxis));
      }
      clusteredLamp.color = lampColor.rgb * lampSpot * getDistanceAttenuation(lampDistance, lampPosition.w, 2.0);
      clusteredLamp.visible = true;
      RE_Direct(clusteredLamp, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    }
  }
}
#endif`
