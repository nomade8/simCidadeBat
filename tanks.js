import * as THREE from 'three';

export default class TankManager {
    constructor(scene, ground, mountainsGroup) {
        this.scene = scene;
        this.ground = ground;
        this.mountainsGroup = mountainsGroup;
        this.tanks = [];
        this.tankBullets = [];
        this.tanksPerPhase = 3;
    }

    createTank(playerPos) {
        const geometry = new THREE.BoxGeometry(2, 1, 3);
        const material = new THREE.MeshPhongMaterial({ color: 0x556b2f });
        const mesh = new THREE.Mesh(geometry, material);
        
        const angle = Math.random() * Math.PI * 2;
        const dist = 50 + Math.random() * 50;
        mesh.position.set(
            playerPos.x + Math.cos(angle) * dist,
            0.5,
            playerPos.z + Math.sin(angle) * dist
        );
        
        this.scene.add(mesh);
        this.tanks.push({
            mesh,
            health: 150
        });
    }

    updateTanks(playerPos) {
        this.tanks.forEach(tank => {
            tank.mesh.lookAt(playerPos.x, tank.mesh.position.y, playerPos.z);
            if (Math.random() < 0.005) {
                this.tankShoot(tank.mesh.position, playerPos);
            }
        });
    }

    tankShoot(pos, targetPos) {
        const dir = new THREE.Vector3().subVectors(targetPos, pos).normalize();
        const bulletGeom = new THREE.SphereGeometry(0.2);
        const bulletMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const bullet = new THREE.Mesh(bulletGeom, bulletMat);
        bullet.position.copy(pos);
        bullet.userData.velocity = dir.multiplyScalar(0.7);
        this.scene.add(bullet);
        this.tankBullets.push(bullet);
        
        setTimeout(() => {
            this.scene.remove(bullet);
            const idx = this.tankBullets.indexOf(bullet);
            if (idx > -1) this.tankBullets.splice(idx, 1);
        }, 4000);
    }

    updateBullets() {
        this.tankBullets.forEach(b => b.position.add(b.userData.velocity));
    }

    createExplosion(pos) {
        const geom = new THREE.SphereGeometry(1);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff4500 });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(pos);
        this.scene.add(mesh);
        setTimeout(() => this.scene.remove(mesh), 700);
    }

    createTankExplosion(pos) {
        this.createExplosion(pos);
    }

    reset() {
        this.tanks.forEach(t => this.scene.remove(t.mesh));
        this.tanks = [];
        this.tankBullets.forEach(b => this.scene.remove(b));
        this.tankBullets = [];
    }

    startNextPhase(playerPos) {
        this.tanksPerPhase += 1;
    }
}
