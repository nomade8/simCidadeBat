import * as THREE from 'three';

export default class AntiAircraftManager {
    constructor(scene, ground, craterManager = null) {
        this.scene = scene;
        this.ground = ground;
        this.craterManager = craterManager;
        this.batteries = []; // Array para armazenar as baterias
        this.bullets = []; // Array para armazenar os projéteis
        this.numBatteries = 3; // Número de baterias antiaéreas
        this.MAX_RANGE = 100; // Raio máximo de tiro das baterias
    }

    // Método para criar uma bateria antiaérea
    createBattery(position) {
        const batteryGroup = new THREE.Group();

        // Base da bateria (base quadrada)
        const baseGeometry = new THREE.BoxGeometry(3, 1, 3);
        const baseMaterial = new THREE.MeshPhongMaterial({ color: 0x2c3e50, flatShading: true });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.y = 0.5;
        batteryGroup.add(base);

        // Torre da bateria (cilindro)
        const turretGeometry = new THREE.CylinderGeometry(1, 1.2, 1.5, 8);
        const turretMaterial = new THREE.MeshPhongMaterial({ color: 0x34495e, flatShading: true });
        const turret = new THREE.Mesh(turretGeometry, turretMaterial);
        turret.position.y = 1.75;
        batteryGroup.add(turret);

        // Canos da bateria (dois canos)
        const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
        const barrelMaterial = new THREE.MeshPhongMaterial({ color: 0x000000, flatShading: true });
        
        const barrel1 = new THREE.Mesh(barrelGeometry, barrelMaterial);
        barrel1.rotation.z = Math.PI / 2;
        barrel1.position.set(0.5, 2.5, 0);
        batteryGroup.add(barrel1);

        const barrel2 = new THREE.Mesh(barrelGeometry, barrelMaterial);
        barrel2.rotation.z = Math.PI / 2;
        barrel2.position.set(-0.5, 2.5, 0);
        batteryGroup.add(barrel2);

        // Posicionar a bateria
        batteryGroup.position.copy(position);
        batteryGroup.castShadow = true;
        batteryGroup.receiveShadow = true;

        this.scene.add(batteryGroup);

        // Criar bounding box para colisão
        const box = new THREE.Box3().setFromObject(batteryGroup);

        // Adicionar a bateria ao array com vida
        this.batteries.push({
            group: batteryGroup,
            lastShot: 0, // Tempo do último disparo
            health: 200, // 8 tiros * 50 de dano cada
            box: box,
            destroyed: false
        });
    }

    // Método para verificar colisões com projéteis do jogador
    checkCollisions(bullets, explosionCallback, onDestroyed) {
        for (let i = bullets.length - 1; i >= 0; i--) {
            const bullet = bullets[i];
            for (let j = 0; j < this.batteries.length; j++) {
                const battery = this.batteries[j];
                if (!battery.destroyed && battery.box.containsPoint(bullet.position)) {
                    battery.health -= 50; // 50 de dano por tiro do jogador
                    if (explosionCallback) {
                        const size = new THREE.Vector3();
                        battery.box.getSize(size);
                        const scale = (size.x + size.y + size.z) / 10;
                        explosionCallback(bullet.position, scale);
                    }
                    if (battery.health <= 0) {
                        this.destroyBattery(battery);
                        if (onDestroyed) onDestroyed(battery);
                    }
                    return i; 
                }
            }
        }
        return -1;
    }

    // Método para destruir uma bateria
    destroyBattery(battery) {
        battery.destroyed = true;
        this.scene.remove(battery.group);
        if (this.craterManager) {
            this.craterManager.createCrater(battery.group.position, 4.0);
        }
    }

    // Método para inicializar as 3 baterias em posições ao redor da cidade
    initBatteries(cityManager = null) {
        const positions = [
            new THREE.Vector3(-50, 0, 50),
            new THREE.Vector3(50, 0, -50),
            new THREE.Vector3(30, 0, 80)
        ];

        positions.forEach(pos => {
            if (cityManager && cityManager.buildings) {
                let safePos = pos.clone();
                let attempts = 0;
                let collided = true;
                const raycaster = new THREE.Raycaster();
                const down = new THREE.Vector3(0, -1, 0);

                while (collided && attempts < 100) {
                    collided = false;
                    for (const building of cityManager.buildings) {
                        if (!building.destroyed && building.box) {
                            // Expandir levemente a box para ter margem de segurança
                            const tempBox = building.box.clone().expandByScalar(3.5);
                            if (tempBox.containsPoint(safePos)) {
                                collided = true;
                                // Mover para uma nova posição
                                const angle = Math.random() * Math.PI * 2;
                                const distance = 10 + Math.random() * 5;
                                safePos.x += Math.cos(angle) * distance;
                                safePos.z += Math.sin(angle) * distance;
                                break;
                            }
                        }
                    }
                    attempts++;
                }

                // Atualizar posição Y baseado no relevo da nova coordenada X/Z
                if (this.ground) {
                    raycaster.set(new THREE.Vector3(safePos.x, 500, safePos.z), down);
                    const intersects = raycaster.intersectObject(this.ground);
                    if (intersects.length > 0) {
                        safePos.y = intersects[0].point.y;
                    }
                }
                pos.copy(safePos);
            }
            this.createBattery(pos);
        });
    }

    // Método para disparar projéteis em direção ao avião
    batteryShoot(batteryPosition, targetPosition) {
        const direction = new THREE.Vector3().subVectors(targetPosition, batteryPosition).normalize();
        const bulletGeometry = new THREE.SphereGeometry(0.15);
        const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
        bullet.position.copy(batteryPosition);
        bullet.position.y += 2.5; // Posição dos canos
        bullet.userData.velocity = direction.multiplyScalar(1);
        this.scene.add(bullet);
        this.bullets.push(bullet);

        // Remover projétil após alguns segundos
        setTimeout(() => {
            this.scene.remove(bullet);
            const index = this.bullets.indexOf(bullet);
            if (index > -1) this.bullets.splice(index, 1);
        }, 4000);
    }

    // Método para verificar se o alvo está no alcance
    canShoot(batteryPosition, targetPosition) {
        const directionVector = new THREE.Vector3().subVectors(targetPosition, batteryPosition);
        const distance = directionVector.length();
        return distance <= this.MAX_RANGE;
    }

    // Método para atualizar as baterias
    updateBatteries(targetPosition) {
        const currentTime = Date.now();

        this.batteries.forEach(battery => {
            // Ignorar baterias destruídas
            if (battery.destroyed) return;

            // Fazer a torre olhar para o avião
            const targetLook = targetPosition.clone();
            targetLook.y = battery.group.position.y;
            battery.group.lookAt(targetLook);

            // Disparar apenas se o alvo estiver no alcance e a cada 1.5 segundos
            if (currentTime - battery.lastShot > 1500 && this.canShoot(battery.group.position, targetPosition)) {
                this.batteryShoot(battery.group.position, targetPosition);
                battery.lastShot = currentTime;
            }
        });
    }

    // Método para atualizar os projéteis
    updateBullets() {
        this.bullets.forEach(bullet => {
            bullet.position.add(bullet.userData.velocity);
        });
    }

    // Método para resetar as baterias
    reset() {
        this.batteries.forEach(battery => {
            this.scene.remove(battery.group);
        });
        this.batteries = [];
        this.bullets.forEach(bullet => {
            this.scene.remove(bullet);
        });
        this.bullets = [];
    }
}
