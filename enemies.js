import * as THREE from 'three';
import {
    createEnemyInstancedPlanes,
    updateEnemyInstance,
    hideEnemyInstance,
    markEnemyInstancesDirty,
    getEnemyBoundingBox
} from './planeFactory.js';

const _direction = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _predictedTarget = new THREE.Vector3();
const _enemyBox = new THREE.Box3();

const _explosionSound = new Audio('explosion boa.mp3');
_explosionSound.volume = 0.3;
_explosionSound.preload = 'auto';

export default class EnemyManager {
    constructor(scene, mountainsGroup, craterManager = null, cityBounds = null) {
        this.scene = scene;
        this.mountainsGroup = mountainsGroup;
        this.craterManager = craterManager;
        this.enemies = [];
        this.bullets = [];
        this.enemyBullets = [];
        this.smokeParticles = [];
        this.debrisParticles = []; // Guarda os destroços caindo do avião
        this.score = 0;
        this.enemiesPerPhase = 7;
        this.maxEnemies = 30;
        this.gameState = 'playing';
        this.scoreDisplay = document.getElementById('score');
        this.cityBounds = cityBounds || {
            minX: -180,
            maxX: 180,
            minZ: -180,
            maxZ: 180,
            minY: 30,
            maxY: 90
        };
        this.attackDistance = 120;
        this.attackAngleCos = Math.cos(THREE.MathUtils.degToRad(60));
        this.enemyShotCooldownMs = 1500;
        this.enemyBulletSpeed = 0.8;
        this.enemyBulletLifetimeMs = 3200;
        this.playerVelocity = new THREE.Vector3();
        this.lastPlayerPos = null;
        this.patrolSpeed = 0.18;
        this.turnSpeed = 0.014; // Curvas mais lentas e suaves

        const { instancedMeshes, dummyRoot } = createEnemyInstancedPlanes(scene, this.maxEnemies);
        this.instancedMeshes = instancedMeshes;
        this.dummyRoot = dummyRoot;
        this.freeInstanceIndices = Array.from({ length: this.maxEnemies }, (_, i) => i);
    }

    updateScore() {
        if (this.scoreDisplay) {
            this.scoreDisplay.textContent = this.score;
        }
    }

    // Toca som de explosão
    playExplosionSound() {
        const audio = _explosionSound.cloneNode();
        audio.volume = 0.3;
        audio.play().catch(() => {});
    }

    _allocateInstanceIndex() {
        if (this.freeInstanceIndices.length === 0) return -1;
        return this.freeInstanceIndices.pop();
    }

    _releaseInstanceIndex(index) {
        hideEnemyInstance(this.instancedMeshes, index);
        this.freeInstanceIndices.push(index);
        markEnemyInstancesDirty(this.instancedMeshes);
    }

    _randomPatrolTarget() {
        const { minX, maxX, minZ, maxZ, minY, maxY } = this.cityBounds;
        return new THREE.Vector3(
            THREE.MathUtils.lerp(minX, maxX, Math.random()),
            THREE.MathUtils.lerp(minY, maxY, Math.random()),
            THREE.MathUtils.lerp(minZ, maxZ, Math.random())
        );
    }

    _clampToCityBounds(position) {
        const { minX, maxX, minZ, maxZ, minY, maxY } = this.cityBounds;
        position.x = THREE.MathUtils.clamp(position.x, minX, maxX);
        position.y = THREE.MathUtils.clamp(position.y, minY, maxY);
        position.z = THREE.MathUtils.clamp(position.z, minZ, maxZ);
    }

    _syncEnemyTransform(enemy) {
        updateEnemyInstance(
            this.instancedMeshes,
            this.dummyRoot,
            enemy.instanceIndex,
            enemy.position,
            enemy.rotation
        );
    }

    _steerToward(enemy, targetDir, turnFactor = this.turnSpeed) {
        if (targetDir.lengthSq() < 0.0001) return;

        const targetYaw = Math.atan2(targetDir.x, targetDir.z);
        let yawDelta = targetYaw - enemy.rotation.y;
        while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
        while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
        enemy.rotation.y += yawDelta * turnFactor;

        const horizontalDist = Math.sqrt(targetDir.x * targetDir.x + targetDir.z * targetDir.z);
        const targetPitch = -Math.atan2(targetDir.y, horizontalDist);
        enemy.rotation.x = THREE.MathUtils.lerp(enemy.rotation.x, targetPitch, turnFactor);

        // Inclinação lateral (banking/roll) ao fazer curvas
        const rollFactor = 8.0; // Fator de inclinação
        const maxEnemyRoll = 0.7; // Limite máximo de inclinação lateral
        const targetRoll = THREE.MathUtils.clamp(-yawDelta * rollFactor, -maxEnemyRoll, maxEnemyRoll);
        enemy.rotation.z = THREE.MathUtils.lerp(enemy.rotation.z, targetRoll, 0.05);
    }

    _getForward(enemy, target = _forward) {
        target.set(0, 0, 1).applyEuler(enemy.rotation);
        return target;
    }

    _updatePlayerVelocity(playerPos) {
        // Estima a velocidade do jogador entre os frames
        if (!this.lastPlayerPos) {
            this.lastPlayerPos = playerPos.clone();
            this.playerVelocity.set(0, 0, 0);
            return;
        }

        this.playerVelocity.copy(playerPos).sub(this.lastPlayerPos).multiplyScalar(0.35).addScaledVector(this.playerVelocity, 0.65);
        this.lastPlayerPos.copy(playerPos);
    }

    _isPlayerInFrontForShot(enemy, playerPos) {
        // Calcula se o jogador está no cone frontal de tiro
        _toPlayer.subVectors(playerPos, enemy.position);
        const distanceToPlayer = _toPlayer.length();
        if (distanceToPlayer > this.attackDistance || distanceToPlayer < 0.001) return false;

        _toPlayer.divideScalar(distanceToPlayer);
        this._getForward(enemy);
        return _forward.dot(_toPlayer) >= this.attackAngleCos;
    }

    _getPredictedShotTarget(enemy, playerPos) {
        // Antecipa levemente a posição do jogador para o tiro
        const distanceToPlayer = enemy.position.distanceTo(playerPos);
        const leadFrames = Math.min(distanceToPlayer / this.enemyBulletSpeed, 18);
        return _predictedTarget.copy(playerPos).addScaledVector(this.playerVelocity, leadFrames);
    }

    _tryEnemyShot(enemy, playerPos, now) {
        // Dispara se o inimigo não estiver morrendo, se estiver de frente para o jogador e fora do cooldown
        if (enemy.isDying) return;
        if (now - enemy.lastShotTime < this.enemyShotCooldownMs) return;
        if (!this._isPlayerInFrontForShot(enemy, playerPos)) return;

        enemy.lastShotTime = now;
        this.enemyShoot(enemy.position.clone(), this._getPredictedShotTarget(enemy, playerPos));
    }

    createEnemy(playerPos = null) {
        const instanceIndex = this._allocateInstanceIndex();
        if (instanceIndex === -1) return;

        const position = this._randomPatrolTarget();
        if (playerPos) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 80;
            position.set(
                playerPos.x + Math.cos(angle) * dist,
                THREE.MathUtils.lerp(this.cityBounds.minY, this.cityBounds.maxY, Math.random()),
                playerPos.z + Math.sin(angle) * dist
            );
            this._clampToCityBounds(position);
        }

        const enemy = {
            instanceIndex,
            position,
            rotation: new THREE.Euler(0, Math.random() * Math.PI * 3, 0, 'YXZ'),
            patrolTarget: this._randomPatrolTarget(),
            health: 150,
            speed: this.patrolSpeed + Math.random() * 0.05,
            isDying: false,
            lastShotTime: 0,
            deathSpin: 0
        };

        this._syncEnemyTransform(enemy);
        markEnemyInstancesDirty(this.instancedMeshes);
        this.enemies.push(enemy);
    }

    spawnInitialEnemies(playerPos) {
        for (let i = 0; i < this.enemiesPerPhase; i++) {
            this.createEnemy(playerPos);
        }
    }

    updateEnemies(playerPos) {
    const now = performance.now();
    let instancesDirty = false;

    this._updatePlayerVelocity(playerPos);

    // Atualiza as partículas de fumaça
    // Atualizar partículas de fumaça
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
        const p = this.smokeParticles[i];
        p.mesh.position.add(p.velocity);
        p.mesh.scale.multiplyScalar(p.grow);
        p.mesh.material.opacity -= 0.015;
        if (p.mesh.material.opacity <= 0) {
            this.scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
            this.smokeParticles.splice(i, 1);
        }
    }

    // Atualizar destroços (debris)
    for (let i = this.debrisParticles.length - 1; i >= 0; i--) {
        const d = this.debrisParticles[i];
        
        // Aplica gravidade ao destroço
        d.velocity.y -= 0.003;
        
        // Aplica movimento e rotação
        d.mesh.position.add(d.velocity);
        d.mesh.rotation.x += d.rotationVelocity.x;
        d.mesh.rotation.y += d.rotationVelocity.y;
        d.mesh.rotation.z += d.rotationVelocity.z;
        
        // Se bater no chão
        if (d.mesh.position.y < 0) {
            this.scene.remove(d.mesh);
            d.mesh.geometry.dispose();
            d.mesh.material.dispose();
            this.debrisParticles.splice(i, 1);
        }
    }

    this.enemies.forEach((enemy) => {
        if (enemy.isDying) {
            if (Math.random() < 0.6) {
                this.createSmokeParticle(enemy.position);
            }

            // --- INICIALIZAÇÃO DA MORTE (Garante que as variáveis existam) ---
            if (!enemy.deathVelocity) {
                const forward = new THREE.Vector3();
                this._getForward(enemy, forward);
                enemy.deathVelocity = forward.clone().multiplyScalar(enemy.speed || 0.15);
            }
            // -----------------------------------------------------------------

            // 1. Movimento Horizontal e Vertical (Parábola com gravidade e arrasto)
            enemy.deathVelocity.y -= 0.002; // Gravidade
            enemy.deathVelocity.x *= 1; // Arrasto horizontal
            enemy.deathVelocity.z *= 1; // Mantém a inércia horizontal para a parábola

            enemy.position.add(enemy.deathVelocity);
            
            // 2. Rotação alinhada à trajetória com efeito de parafuso (roll)
            const speedH = Math.sqrt(enemy.deathVelocity.x * enemy.deathVelocity.x + enemy.deathVelocity.z * enemy.deathVelocity.z);
            if (speedH > 0.01) {
                enemy.rotation.y = Math.atan2(enemy.deathVelocity.x, enemy.deathVelocity.z);
                enemy.rotation.x = -Math.atan2(enemy.deathVelocity.y, speedH);
            }
            
            // Giro rápido em parafuso sobre o próprio eixo
            enemy.rotation.z += 0.05;
            
            this._syncEnemyTransform(enemy);
            instancesDirty = true;

            // Condição de impacto com o chão
            if (enemy.position.y < 0) {
                // Toca som de explosão ao bater no chão
                this.playExplosionSound?.();

                this.createExplosion(enemy.position.clone(), 1.5);

                if (this.craterManager) {
                    this.craterManager.createCrater(enemy.position.clone(), 3.5);
                }
                this.score += 30; // +30 pontos quando destruído no chão
                this.updateScore();
                this.removeEnemy(enemy);
            }
            return;
        }

        // --- COMPORTAMENTO DO INIMIGO VIVO (só patrulha) ---
        _direction.subVectors(enemy.patrolTarget, enemy.position);
        const distToTarget = _direction.length();

        if (distToTarget < 10 || Math.random() < 0.0015) {
            enemy.patrolTarget = this._randomPatrolTarget();
            _direction.subVectors(enemy.patrolTarget, enemy.position);
        }

        if (_direction.lengthSq() > 0.0009) {
            _direction.normalize();
            this._steerToward(enemy, _direction);
            this._getForward(enemy);
            
            // Inicializa vetor de velocidade se não existir
            if (!enemy.velocity) {
                enemy.velocity = new THREE.Vector3();
            }
            
            // Interpolação no voo (inércia física): o vetor de velocidade segue a direção frontal suavemente
            const targetVelocity = _forward.clone().multiplyScalar(enemy.speed);
            enemy.velocity.lerp(targetVelocity, 0.05);
            enemy.position.add(enemy.velocity);
            
            this._clampToCityBounds(enemy.position);
        } else {
            if (enemy.velocity) {
                enemy.velocity.multiplyScalar(1);
                enemy.position.add(enemy.velocity);
            }
            enemy.rotation.z = THREE.MathUtils.lerp(enemy.rotation.z, 0, 1);
        }

        // Tenta atirar no jogador quando ele estiver à frente
        this._tryEnemyShot(enemy, playerPos, now);

        if (enemy.health < 150) {
            if (Math.random() < 0.15) {
                this.createSmokeParticle(enemy.position);
            }
        }

        this._syncEnemyTransform(enemy);
        instancesDirty = true;
    });

    if (instancesDirty) {
        markEnemyInstancesDirty(this.instancedMeshes);
    }
}
    shoot(pos, dir) {
        const bulletGeom = new THREE.SphereGeometry(0.08);
        const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const bullet = new THREE.Mesh(bulletGeom, bulletMat);
        bullet.position.copy(pos);
        bullet.userData.velocity = dir.clone().multiplyScalar(1);
        this.scene.add(bullet);
        this.bullets.push(bullet);

        setTimeout(() => {
            this.scene.remove(bullet);
            const idx = this.bullets.indexOf(bullet);
            if (idx > -1) this.bullets.splice(idx, 1);
        }, 2000);
    }

    enemyShoot(pos, targetPos) {
        const dir = new THREE.Vector3().subVectors(targetPos, pos).normalize();
        const bulletGeom = new THREE.SphereGeometry(0.12);
        const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const bullet = new THREE.Mesh(bulletGeom, bulletMat);
        bullet.position.copy(pos);
        bullet.userData.velocity = dir.multiplyScalar(this.enemyBulletSpeed);
        this.scene.add(bullet);
        this.enemyBullets.push(bullet);

        setTimeout(() => {
            this.scene.remove(bullet);
            const idx = this.enemyBullets.indexOf(bullet);
            if (idx > -1) this.enemyBullets.splice(idx, 1);
        }, this.enemyBulletLifetimeMs);
    }

    updateBullets() {
        this.bullets.forEach((b) => b.position.add(b.userData.velocity));
        this.enemyBullets.forEach((b) => b.position.add(b.userData.velocity));
    }

    checkBulletCollisions(onEnemyDestroyed) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i];

            for (let j = this.enemies.length - 1; j >= 0; j--) {
                const enemy = this.enemies[j];
                
                if (enemy.isDying) continue;

                getEnemyBoundingBox(enemy.position, _enemyBox);
                _enemyBox.expandByScalar(0.5);

                if (_enemyBox.containsPoint(bullet.position)) {
                    enemy.health -= 50;
                    enemy.underAttack = true; // Ativa modo de ataque ao ser atingido
                    this.score += 30; // 30 pontos por cada tiro acertado
                    this.updateScore();
                    this.playExplosionSound(); 
                    this.scene.remove(bullet);
                    this.bullets.splice(i, 1);

                    if (enemy.health <= 0) {
                        this.createExplosion(enemy.position.clone(), 0.6);
                        this.startEnemyDeathSpiral(enemy);
                        if (onEnemyDestroyed) onEnemyDestroyed(enemy);
                    }
                    break;
                }
            }
        }
    }

    createExplosion(pos, scale = 1) {
        const explosionGroup = new THREE.Group();
        explosionGroup.position.copy(pos);
        this.scene.add(explosionGroup);

        const particleCount = 6;
        const particles = [];

        for (let i = 0; i < particleCount; i++) {
            const size = (0.5 + Math.random() * 0.5) * scale;
            const geom = new THREE.SphereGeometry(size, 8, 8);
            const color = new THREE.Color().setHSL(0.05 + Math.random() * 0.1, 1, 0.5);
            const mat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.9
            });
            const mesh = new THREE.Mesh(geom, mat);

            mesh.position.set(
                (Math.random() - 0.5) * scale,
                (Math.random() - 0.5) * scale,
                (Math.random() - 0.5) * scale
            );

            explosionGroup.add(mesh);
            particles.push({
                mesh: mesh,
                velocity: mesh.position.clone().normalize().multiplyScalar(0.1 * scale),
                grow: 1.02 + Math.random() * 0.05
            });
        }

        let frames = 0;
        const maxFrames = 40;

        const animateExplosion = () => {
            frames++;
            const life = 1 - (frames / maxFrames);

            particles.forEach((p) => {
                p.mesh.position.add(p.velocity);
                p.mesh.scale.multiplyScalar(p.grow);
                p.mesh.material.opacity = life;
            });

            if (frames < maxFrames) {
                requestAnimationFrame(animateExplosion);
            } else {
                this.scene.remove(explosionGroup);
                particles.forEach((p) => {
                    p.mesh.geometry.dispose();
                    p.mesh.material.dispose();
                });
            }
        };

        animateExplosion();
    }

    createSmokeParticle(pos) {
        const geom = new THREE.SphereGeometry(0.15 + Math.random() * 0.15, 5, 5);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x444444,
            transparent: true,
            opacity: 0.7
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(pos).add(new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2
        ));
        this.scene.add(mesh);
        this.smokeParticles.push({
            mesh: mesh,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.01,
                0.01 + Math.random() * 0.02,
                (Math.random() - 0.5) * 0.01
            ),
            grow: 1.01 + Math.random() * 0.02
        });
    }

    startEnemyDeathSpiral(enemy) {
        enemy.isDying = true;
        if (enemy.velocity) {
            enemy.deathVelocity = enemy.velocity.clone();
        } else {
            const forward = new THREE.Vector3();
            this._getForward(enemy, forward);
            enemy.deathVelocity = forward.clone().multiplyScalar(enemy.speed || 0.15);
        }
        
        // Gera pedaços (debris) saindo do avião
        this.createDebris(enemy.position.clone(), enemy.deathVelocity);
    }

    createDebris(pos, baseVelocity) {
        const debrisCount = 4 + Math.floor(Math.random() * 4);
        const materials = [
            new THREE.MeshPhongMaterial({ color: 0x0e036b, flatShading: true }), // Fuselagem azul
            new THREE.MeshPhongMaterial({ color: 0xcc0000, flatShading: true }), // Fuselagem vermelha
            new THREE.MeshPhongMaterial({ color: 0x777777, flatShading: true }), // Struts cinza
            new THREE.MeshPhongMaterial({ color: 0x333333, flatShading: true })  // Pneus/rodas
        ];

        for (let i = 0; i < debrisCount; i++) {
            // Tamanho e geometria aleatória para cada pedaço
            const w = 0.05 + Math.random() * 0.15;
            const h = 0.05 + Math.random() * 0.15;
            const d = 0.05 + Math.random() * 0.15;
            const geom = new THREE.BoxGeometry(w, h, d);
            
            // Escolhe material aleatório
            const mat = materials[Math.floor(Math.random() * materials.length)];
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.copy(pos);
            
            // Rotação inicial aleatória
            mesh.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            
            // Velocidade inicial combinando o vetor do avião com um espalhamento
            const vel = baseVelocity.clone().add(new THREE.Vector3(
                (Math.random() - 0.5) * 0.08,
                (Math.random() - 0.2) * 0.08, // tende a subir um pouco levemente
                (Math.random() - 0.5) * 0.08
            ));
            
            // Rotação angular aleatória (spin)
            const rotVel = new THREE.Euler(
                (Math.random() - 0.5) * 0.15,
                (Math.random() - 0.5) * 0.15,
                (Math.random() - 0.5) * 0.15
            );

            this.scene.add(mesh);
            this.debrisParticles.push({
                mesh: mesh,
                velocity: vel,
                rotationVelocity: rotVel
            });
        }
    }

    removeEnemy(enemy) {
        this._releaseInstanceIndex(enemy.instanceIndex);
        const idx = this.enemies.indexOf(enemy);
        if (idx > -1) this.enemies.splice(idx, 1);
    }

    getEnemyBoundingBox(enemy, target = new THREE.Box3()) {
        return getEnemyBoundingBox(enemy.position, target);
    }

    updateScoreDisplay() {
        if (this.scoreDisplay) this.scoreDisplay.textContent = this.score;
    }

    reset() {
        this.enemies.forEach((enemy) => hideEnemyInstance(this.instancedMeshes, enemy.instanceIndex));
        this.enemies = [];
        this.freeInstanceIndices = Array.from({ length: this.maxEnemies }, (_, i) => i);
        markEnemyInstancesDirty(this.instancedMeshes);

        this.bullets.forEach((b) => this.scene.remove(b));
        this.bullets = [];
        this.enemyBullets.forEach((b) => this.scene.remove(b));
        this.enemyBullets = [];
        
        this.smokeParticles.forEach((p) => {
            this.scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
        });
        this.smokeParticles = [];

        this.debrisParticles.forEach((d) => {
            this.scene.remove(d.mesh);
            d.mesh.geometry.dispose();
            d.mesh.material.dispose();
        });
        this.debrisParticles = [];

        this.score = 0;
        this.gameState = 'playing';
        this.updateScoreDisplay();
    }

    startNextPhase(playerPos) {
        this.gameState = 'playing';
        this.enemiesPerPhase += 2;
        for (let i = 0; i < this.enemiesPerPhase; i++) {
            this.createEnemy(playerPos);
        }
    }
}
