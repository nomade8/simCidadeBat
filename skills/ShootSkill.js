import Skill from './Skill.js';
import * as THREE from 'three';

export default class ShootSkill extends Skill {
    constructor(cooldown = 2000) {
        super('Shoot', cooldown);
    }

    execute({ agent, targetPos, scene, bulletsArray, color = 0xff0000, speed = 0.5 }) {
        if (!agent || !targetPos || !scene || !bulletsArray) return;

        const pos = agent.position || agent.mesh.position;
        const dir = new THREE.Vector3().subVectors(targetPos, pos).normalize();
        
        const bulletGeom = new THREE.SphereGeometry(0.1);
        const bulletMat = new THREE.MeshBasicMaterial({ color: color });
        const bullet = new THREE.Mesh(bulletGeom, bulletMat);
        
        bullet.position.copy(pos);
        bullet.userData.velocity = dir.multiplyScalar(speed);
        
        scene.add(bullet);
        bulletsArray.push(bullet);
        
        // Auto-remove after some time
        setTimeout(() => {
            scene.remove(bullet);
            const idx = bulletsArray.indexOf(bullet);
            if (idx > -1) bulletsArray.splice(idx, 1);
        }, 3000);

        console.log(`${agent.name || 'Agent'} used Shoot Skill!`);
    }
}
