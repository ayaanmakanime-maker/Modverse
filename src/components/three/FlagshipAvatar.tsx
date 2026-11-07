"use client";
/**
 * Renders a flagship avatar (Atlas / Aura) as skinned meshes sharing
 * one THREE.Skeleton. Geometry comes from body measurements, so changing a
 * proportion rebuilds the body; poses rotate real bones.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { buildAvatar, poseRotations, type AvatarBody, type AvatarStyle } from "@/lib/three/flagship-avatar";

const HAIR: Record<string, string> = { atlas: "#21160f", aura: "#3a2216" };

export function FlagshipAvatar({ body, style, position }: { body: AvatarBody; style: AvatarStyle; position?: [number, number, number] }) {
  const rig = useMemo(() => buildAvatar(body, style), [body, style]);
  const group = useMemo(() => {
    const g = new THREE.Group();
    g.name = `avatar-${rig.model}`;
    const bones = rig.bones.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      return bone;
    });
    rig.bones.forEach((b, i) => {
      const p = b.parent >= 0 ? rig.bones[b.parent].position : [0, 0, 0];
      bones[i].position.set(b.position[0] - p[0], b.position[1] - p[1], b.position[2] - p[2]);
      if (b.parent >= 0) bones[b.parent].add(bones[i]);
    });
    g.add(bones[0]);
    g.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    const skin = new THREE.Color(style.skinTone);
    const mats: Record<string, THREE.Material> = {
      skin: new THREE.MeshPhysicalMaterial({ color: skin, roughness: 0.58, sheen: 0.35, sheenRoughness: 0.55, sheenColor: skin.clone().lerp(new THREE.Color("#ffd9c4"), 0.5), specularIntensity: 0.35 }),
      hair: new THREE.MeshStandardMaterial({ color: HAIR[rig.model], roughness: 0.82 }),
      trousers: new THREE.MeshStandardMaterial({ color: "#1b1b1e", roughness: 0.93 }),
      shoes: new THREE.MeshStandardMaterial({ color: "#f2f1ec", roughness: 0.55 }),
      soles: new THREE.MeshStandardMaterial({ color: "#d8d4ca", roughness: 0.7 }),
    };
    for (const p of rig.parts) {
      if (!p.indices.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(p.positions, 3));
      geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(p.skinIndex, 4));
      geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(p.skinWeight, 4));
      geo.setIndex(p.indices);
      geo.computeVertexNormals();
      const mesh = new THREE.SkinnedMesh(geo, mats[p.name]);
      mesh.name = `avatar-${p.name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      g.add(mesh);
      mesh.bind(skeleton);
    }
    // Pose = bone rotations on top of the sleeve-matched bind pose.
    const rot = poseRotations(style.pose ?? "fit", style.armDropDeg);
    for (const [name, z] of Object.entries(rot)) {
      const bone = bones.find((b) => b.name === name);
      if (bone && z) bone.rotation.z = z;
    }
    return g;
  }, [rig, style.skinTone, style.pose, style.armDropDeg]);
  useEffect(() => () => {
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }, [group]);
  return <primitive object={group} position={position ?? [0, 0, 0]} />;
}
