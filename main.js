import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import EnemyManager from './enemies.js';
import { createPlayerPlane, PLANE_SCALE } from './planeFactory.js';
import CraterManager from './craterManager.js';
import TankManager from './tanks.js';
import CityManager from './city.js';
import AntiAircraftManager from './antiAircraft.js';
import MissionManager from './missionManager.js';

// Adiciona o método de raycast acelerado ao protótipo do Mesh
THREE.Mesh.prototype.raycast = acceleratedRaycast;

class LandingSimulator {
    constructor() {
        console.log("Iniciando simulador...");
        try {
            this.gameStarted = false;
            this.gameOver = false;
            this.gameOverDisplayed = false;
            this.finalAnalysisDisplayed = false;
            this.playerHealth = 100;
            this.healthBar = document.getElementById('healthBar');
            this.gameOverScreen = document.getElementById('gameOverScreen');
            this.finalScoreElement = document.getElementById('finalScore');
            this.missionNumberElement = document.getElementById('missionNumber');
            this.targetsHitElement = document.getElementById('targetsHit');
            this.targetsTotalElement = document.getElementById('targetsTotal');
            this.missionStatusElement = document.querySelector('.mission-status');
            this.updateHealthBar();
            this.engineAudioStarted = false;
            this.landingStopStartTime = null;
            this.landingActionTriggered = false;

            // Touchdown tracking states
            this.hasFlew = false;
            this._wasOnGround = true;
            this.touchdownSpeed = 0;
            this.touchdownXDiff = 0;
            this.touchdownPitch = 0;
            this.touchdownRoll = 0;
            this.hasTouchdownData = false;

            // Create scene first
            this.scene = new THREE.Scene();

            // Then set scene properties
            // Ajuste do fog para um visual mais suave e distante
            const fogColor = new THREE.Color('#7acdf3');
            this.scene.background = fogColor;
            this.scene.fog = new THREE.Fog(fogColor, 1, 1000);

            // Criar elemento de mensagem de pouso
            this.createLandingMessage();
            console.log("Cena criada");

            console.log("Configurando câmera e renderer...");
            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 2000);
            this.renderer = new THREE.WebGLRenderer({
                antialias: false,
                logarithmicDepthBuffer: false
            });
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.BasicShadowMap;

            this.renderer.setSize(window.innerWidth, window.innerHeight);
            document.body.appendChild(this.renderer.domElement);

            // Configurar post-processing para Depth of Field
            this.composer = new EffectComposer(this.renderer);
            const renderPass = new RenderPass(this.scene, this.camera);
            this.composer.addPass(renderPass);



            const outputPass = new OutputPass();
            this.composer.addPass(outputPass);

            // Estilos já definidos no HTML

            this.createSkyGradient();


            // Iluminação
            this.setupLights();

            // Criar cenário
            this.createScene();

            // Gerenciador de crateras (texturas procedurais de buracos)
            this.craterManager = new CraterManager(this.scene, this.ground);

            // Se a cidade já foi criada dentro de createScene, conecta o gerenciador de crateras
            if (this.cityManager) this.cityManager.craterManager = this.craterManager;


            // Criar avião (needs to be created before camera setup uses its position)
            this.createPlane();

            this.cameraOffset = new THREE.Vector3(0, 1.0, -1); // Initialize cameraOffset here

            // Inicializar gerenciador de inimigos (fornecendo craterManager para criar buracos no solo)
            this.enemyManager = new EnemyManager(this.scene, this.mountainsGroup, this.craterManager, {
                minX: -180,
                maxX: 180,
                minZ: -180,
                maxZ: 180,
                minY: 30,
                maxY: 90
            });
            this.enemyManager.spawnInitialEnemies(this.airplane.position);

            // Inicializar gerenciador de tanques
            this.tankManager = new TankManager(this.scene, this.ground, this.mountainsGroup);
            /*
            // Criar tanques iniciais da primeira fase
            for (let i = 0; i < this.tankManager.tanksPerPhase; i++) {
                this.tankManager.createTank(this.airplane.position);
            }
            */

            // Inicializar gerenciador de baterias antiaéreas
            this.antiAircraftManager = new AntiAircraftManager(this.scene, this.ground, this.craterManager);
            this.antiAircraftManager.initBatteries(this.cityManager);

            // Inicializar gerenciador de missões
            this.missionManager = new MissionManager(this.scene, this.cityManager);
            this.missionManager.init();



            // --- Camera Setup Moved Here ---
            this.setupCamera();


            // Controles - Target will be updated dynamically
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.target.copy(this.airplane.position); // Set initial target
            this.controls.enablePan = false; // Allow panning
            this.controls.enableZoom = false; // Allow zooming
            this.controls.enableRotate = false; // Disable manual rotation
            this.controls.enabled = false; // Completely disable OrbitControls

            // --- End of Camera Setup ---
            this.setupControls();
            this.setupEngineAudio();

            // Variáveis de simulação
            this.planeState = {
                speed: 9,
                altitude: 100,
                fuel: 100,
                rotation: 0, // Yaw
                pitch: 0,    // Pitch
                roll: 0,     // Roll
                isTurningLeft: false,
                isTurningRight: false,
                isPitchingUp: false,
                isPitchingDown: false
            };
            this.wingTrailParticles = [];
            this.cameraMode = 'thirdPerson';
            this.createCrosshair();
            this.updateCrosshairVisibility();

            // Estado do efeito de "tranco" na câmera
            this.cameraShake = { frames: 0, totalFrames: 0, intensity: 0 };
            this.cockpitShake = { frames: 0, totalFrames: 0, intensity: 0 };

            // Missão removida a pedido do usuário
            console.log("Iniciando animação...");
            // Start animation after all initialization
            this.animate();
            this.showMissionStartScreen(0);
        } catch (error) {
            console.error("Erro na inicialização:", error);
        }
    }

    updateHealthBar() {
        if (this.healthBar) {
            const healthPercentage = Math.max(0, this.playerHealth); // Garante que não seja negativo
            this.healthBar.style.width = `${healthPercentage}%`;
            // Mudar a cor da barra com base na vida
            if (healthPercentage > 60) {
                this.healthBar.style.backgroundColor = '#4CAF50'; // Verde
            } else if (healthPercentage > 30) {
                this.healthBar.style.backgroundColor = '#ffc107'; // Amarelo
            } else {
                this.healthBar.style.backgroundColor = '#f44336'; // Vermelho
            }
        }
    }

    setupLights() {
        // Luz ambiente mais suave
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        // Luz principal (sol) com sombras melhoradas
        const sunLight = new THREE.DirectionalLight(0xffffff, 0.7);
        sunLight.position.set(50, 200, 100);
        sunLight.castShadow = true;

        // Configurações de alta qualidade para sombras
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = 500;
        sunLight.shadow.camera.left = -100;
        sunLight.shadow.camera.right = 100;
        sunLight.shadow.camera.top = 100;
        sunLight.shadow.camera.bottom = -100;
        sunLight.shadow.autoUpdate = true;
        this.sunLight = sunLight;



        this.scene.add(sunLight);

        // Luz secundária (preenchimento) para detalhes nas sombras
        const fillLight = new THREE.DirectionalLight(0x8088ff, 0.5); // Tom levemente azulado
        fillLight.position.set(-50, 100, -100);
        fillLight.shadow.autoUpdate = false;
        this.scene.add(fillLight);

        // Luz de realce (rim light) para melhorar a profundidade
        const rimLight = new THREE.DirectionalLight(0xfff0dd, 0.5); // Tom levemente amarelado
        rimLight.position.set(0, 50, -200);
        rimLight.shadow.autoUpdate = false;
        this.scene.add(rimLight);
    }

    createScene() {
        // Terreno com proporções maiores
        const groundGeometry = new THREE.PlaneGeometry(3000, 3000, 10, 10);

        // Adicionar variação de altura mais suave no terreno
        const vertices = groundGeometry.attributes.position.array;
        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i];
            const y = vertices[i + 1];

            // Terreno totalmente plano
            vertices[i + 2] = 0;
        }

        groundGeometry.computeVertexNormals();
        groundGeometry.boundsTree = new MeshBVH(groundGeometry);

        // Criar textura procedural realista para o terreno
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(512, 512);

        // Função de ruído simples para criar variações naturais
        function noise(x, y) {
            const n = Math.sin(x * 0.01) * Math.cos(y * 0.01) +
                Math.sin(x * 0.02) * Math.cos(y * 0.02) * 0.5 +
                Math.sin(x * 0.05) * Math.cos(y * 0.05) * 0.25;
            return (n + 1) / 2; // Normalizar para 0-1
        }

        // Gerar textura pixel por pixel
        for (let x = 0; x < 512; x++) {
            for (let y = 0; y < 512; y++) {
                const index = (y * 512 + x) * 4;

                // Usar ruído para determinar a mistura entre verde e marrom
                const noiseValue = noise(x, y);
                const secondNoise = noise(x * 3.5, y * 1.5);
                const thirdNoise = noise(x * 3, y * 3);

                // Combinar diferentes escalas de ruído
                const finalNoise = (noiseValue * 0.6 + secondNoise * 0.3 + thirdNoise * 0.1);

                // Cores base
                const greenR = 15, greenG = 90, greenB = 22;  // Verde escuro
                const brownR = 35, brownG = 80, brownB = 13; // Marrom terra

                // Interpolar entre verde e marrom baseado no ruído
                const r = Math.floor(greenR + (brownR - greenR) * finalNoise);
                const g = Math.floor(greenG + (brownG - greenG) * finalNoise);
                const b = Math.floor(greenB + (brownB - greenB) * finalNoise);

                // Adicionar pequenas variações aleatórias para textura
                const variation = (Math.random() - 0.8) * 30;

                imageData.data[index] = Math.max(0, Math.min(255, r + variation));     // R
                imageData.data[index + 1] = Math.max(0, Math.min(255, g + variation)); // G
                imageData.data[index + 2] = Math.max(0, Math.min(255, b + variation)); // B
                imageData.data[index + 3] = 255; // A
            }
        }

        ctx.putImageData(imageData, 0, 0);

        // Criar textura do Three.js
        const terrainTexture = new THREE.CanvasTexture(canvas);
        terrainTexture.wrapS = THREE.RepeatWrapping;
        terrainTexture.wrapT = THREE.RepeatWrapping;
        terrainTexture.repeat.set(6, 6); // Repetir a textura

        // Ativar Anisotropia para melhorar detalhes no horizonte
        const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
        terrainTexture.anisotropy = maxAnisotropy;

        const groundMaterial = new THREE.MeshStandardMaterial({
            map: terrainTexture,
            color: '#ffffff',
            roughness: 0.9,
            metalness: 0.0,
            flatShading: false
        });

        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);

        // Montanhas estilizadas (Removidas a pedido do usuário)
        // this.createStylizedMountains();

        // Pista de pouso
        this.createRunway();



        // Vegetação estilizada (ajustada para o novo tamanho e relevo)
        this.ground.updateMatrixWorld(true);
        this.createStylizedVegetation();

        // Nuvens estilizadas
        this.createClouds();

        // Cidade Procedural
        this.cityManager = new CityManager(this.scene, this.ground);
    }

    createStylizedMountains() {
        const mountainMaterial = new THREE.MeshStandardMaterial({
            color: '#b87058',
            roughness: 0.3,
            metalness: 0.1,
            flatShading: true
        });

        const mountains = new THREE.Group();

        // Criar montanhas mais densas e próximas
        for (let i = 0; i < 15; i++) {
            const radius = Math.random() * 15 + 6; // Montanhas um pouco maiores
            const mountainGeometry = new THREE.IcosahedronGeometry(radius, 2); // Aumentado o detalhe

            // Adicionar variação mais suave aos vértices
            const vertices = mountainGeometry.attributes.position.array;
            for (let j = 0; j < vertices.length; j += 3) {
                const noise = (Math.random() * 0.2) + 0.1; // Menor variação aleatória
                vertices[j] = noise;
                vertices[j + 1] = noise * 0.5; // Um pouco mais alto
                vertices[j + 2] = noise;
            }

            mountainGeometry.computeVertexNormals();
            mountainGeometry.boundsTree = new MeshBVH(mountainGeometry);

            const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);

            // Posicionar montanhas em um padrão mais circular e denso
            const angle = (i / 15) * Math.PI * 2 + (Math.random() * 0.5 - 0.25);
            const distance = Math.random() * 40 + 100; // Distância mais consistente
            mountain.position.set(
                Math.cos(angle) * distance,
                Math.random() * 4 + 2, // Altura mais consistente
                Math.sin(angle) * distance
            );

            // Escala mais uniforme para evitar deformações estranhas
            const baseScale = Math.random() * 1.0 + 1.0;
            mountain.scale.set(
                baseScale,
                baseScale * (Math.random() * 2 + 2.2), // Altura um pouco variada
                baseScale
            );

            // Rotação mais sutil
            mountain.rotation.set(
                Math.random() * 0.1,
                Math.random() * Math.PI,
                Math.random() * 0.2
            );

            // Adicionar sub-montanhas para criar continuidade
            for (let j = 0; j < 3; j++) {
                const subRadius = radius * 0.6;
                const subMountain = new THREE.Mesh(
                    new THREE.IcosahedronGeometry(subRadius, 2),
                    mountainMaterial
                );

                // Posicionar próximo à montanha principal
                const subAngle = Math.random() * Math.PI * 2;
                const subDistance = radius * 1.2;
                subMountain.position.set(
                    Math.cos(subAngle) * subDistance,
                    -radius * 0.3, // Um pouco mais baixo
                    Math.sin(subAngle) * subDistance
                );

                subMountain.scale.set(
                    Math.random() * 0.3 + 0.7,
                    Math.random() * 0.3 + 0.7,
                    Math.random() * 0.3 + 0.7
                );

                mountain.add(subMountain);
            }

            mountain.castShadow = true;
            mountain.receiveShadow = true;

            mountains.add(mountain);
        }

        this.scene.add(mountains);
        this.mountainsGroup = mountains; // Armazenar referência para detecção de colisão
    }

    createRunway() {
        const runwayGroup = new THREE.Group();

        // 1. Base/Bordas de Concreto (camada inferior)
        const baseWidth = 8;
        const baseLength = 180;
        const baseGeometry = new THREE.PlaneGeometry(baseWidth, baseLength);
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x2b2b2b, // Cinza concreto escuro
            roughness: 0.9,
            metalness: 0.1,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.rotation.x = -Math.PI / 2;
        base.position.y = 0.01;
        base.receiveShadow = true;
        base.frustumCulled = false;
        runwayGroup.add(base);

        // 2. Pista Principal (Asfalto - camada intermediária)
        const runwayWidth = 7;
        const runwayLength = 170;
        const runwayGeometry = new THREE.PlaneGeometry(runwayWidth, runwayLength);
        const runwayMaterial = new THREE.MeshStandardMaterial({
            color: '#323740', // Asfalto muito escuro
            roughness: 0.8,
            metalness: 0.1,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        });
        const runway = new THREE.Mesh(runwayGeometry, runwayMaterial);
        runway.rotation.x = -Math.PI / 2;
        runway.position.y = 0.02;
        runway.receiveShadow = true;
        runway.frustumCulled = false;
        this.runwayMesh = runway;
        runwayGroup.add(runway);

        // 3. Marcações com material emissivo brilhante (camada superior)
        const lineMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 0.4,
            roughness: 0.5,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4
        });

        // 3.1 Linhas centrais tracejadas
        for (let z = -75; z <= 75; z += 10) {
            const lineGeometry = new THREE.PlaneGeometry(0.3, 4);
            const line = new THREE.Mesh(lineGeometry, lineMaterial);
            line.rotation.x = -Math.PI / 2;
            line.position.set(0, 0.03, z);
            line.frustumCulled = false;
            runwayGroup.add(line);
        }

        // 3.2 Linhas laterais contínuas
        [-3.5, 3.5].forEach(xOff => {
            const sideLine = new THREE.Mesh(
                new THREE.PlaneGeometry(0.2, 170),
                lineMaterial
            );
            sideLine.rotation.x = -Math.PI / 2;
            sideLine.position.set(xOff, 0.03, 0);
            sideLine.frustumCulled = false;
            runwayGroup.add(sideLine);
        });

        // 3.3 Marcações de cabeceira (Threshold markings - piano keyboard style)
        const createThresholdMarkings = (posZ) => {
            const stripeWidth = 0.35;
            const stripeLength = 6;
            const xPositions = [-3.75, -3.0, -2.25, -1.5, 1.5, 2.25, 3.0, 3.75];
            xPositions.forEach(x => {
                const stripeGeom = new THREE.PlaneGeometry(stripeWidth, stripeLength);
                const stripe = new THREE.Mesh(stripeGeom, lineMaterial);
                stripe.rotation.x = -Math.PI / 2;
                stripe.position.set(x, 0.03, posZ);
                stripe.frustumCulled = false;
                runwayGroup.add(stripe);
            });
        };
        createThresholdMarkings(-80); // Cabeceira Sul
        createThresholdMarkings(80);  // Cabeceira Norte

        // 3.4 Números da pista em CanvasTexture
        const createNumberDecal = (text, zPos, rotationAngle) => {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 128, 256);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 150px "Courier New", Courier, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 64, 128);

            const texture = new THREE.CanvasTexture(canvas);
            const decalMat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -5,
                polygonOffsetUnits: -5
            });
            const decalGeom = new THREE.PlaneGeometry(3.5, 7);
            const decalMesh = new THREE.Mesh(decalGeom, decalMat);
            decalMesh.rotation.x = -Math.PI / 2;
            decalMesh.rotation.z = rotationAngle;
            decalMesh.position.set(0, 0.03, zPos);
            decalMesh.frustumCulled = false;
            runwayGroup.add(decalMesh);
        };

        createNumberDecal("36", -70, 0);
        createNumberDecal("18", 70, Math.PI);

        // 4. Luzes da pista
        const lightGeom = new THREE.SphereGeometry(0.18, 8, 8);
        const greenLightMat = new THREE.MeshBasicMaterial({ color: 0x00ff33 });
        const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
        const whiteLightMat = new THREE.MeshBasicMaterial({ color: '#0339fc' });

        // 4.1 Luzes de cabeceira (verdes no começo, vermelhas no fim)
        for (let x = -6; x <= 6; x += 2) {
            const gLight = new THREE.Mesh(lightGeom, greenLightMat);
            gLight.position.set(x, 0.1, 85);
            runwayGroup.add(gLight);
        }
        for (let x = -6; x <= 6; x += 2) {
            const rLight = new THREE.Mesh(lightGeom, redLightMat);
            rLight.position.set(x, 0.1, -85);
            runwayGroup.add(rLight);
        }

        // 4.2 Luzes de borda brancas
        for (let z = -80; z <= 80; z += 20) {
            [-3.8, 3.8].forEach(x => {
                const edgeLight = new THREE.Mesh(lightGeom, whiteLightMat);
                edgeLight.position.set(x, 0.1, z);
                runwayGroup.add(edgeLight);
            });
        }

        this.scene.add(runwayGroup);
    }



    createStylizedVegetation() {
        // Material base para árvores com variação de cores
        const createTreeMaterial = () => {
            const hue = 0.33 + (Math.random() * 0.1 - 0.05);
            const color = new THREE.Color().setHSL(hue, 0.6, 0.3 + Math.random() * 0.2);
            return new THREE.MeshPhongMaterial({
                color: color,
                flatShading: true,
                shininess: 0
            });
        };

        const createBushMaterial = () => {
            const hue = 0.35 + (Math.random() * 0.1 - 0.05);
            const color = new THREE.Color().setHSL(hue, 0.5, 0.4 + Math.random() * 0.2);
            return new THREE.MeshPhongMaterial({
                color: color,
                flatShading: true,
                shininess: 0
            });
        };

        const vegetationGroup = new THREE.Group();

        // Aumentar a quantidade de vegetação para o terreno maior
        for (let i = 0; i < 250; i++) {
            let vegMesh;
            const randomScale = Math.random() * 0.5 + 0.8;
            const posX = Math.random() * 400 - 200;
            const posZ = Math.random() * 400 - 200;

            // Evitar colocar vegetação na pista e áreas críticas
            if (Math.abs(posX) < 15 && Math.abs(posZ) < 95) continue;

            // Evitar ruas (intervalos de 50 a partir de 0, com margem)
            const modX = Math.abs(posX % 50);
            const modZ = Math.abs(posZ % 50);
            if (modX < 4 || modX > 46 || modZ < 4 || modZ > 46) continue;

            if (Math.random() > 0.4) {
                const treeGroup = new THREE.Group();

                const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.25, 1.8 * randomScale, 5);
                const trunkMaterial = new THREE.MeshPhongMaterial({
                    color: 0x4A2E0F,
                    flatShading: true
                });
                const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
                trunk.position.y = 0.9 * randomScale;
                treeGroup.add(trunk);

                // Copa arredondada (árvores tropicais)
                const numLeaves = Math.floor(Math.random() * 3) + 3;
                const material = createTreeMaterial();
                for (let j = 0; j < numLeaves; j++) {
                    const size = (0.8 + Math.random() * 0.5) * randomScale;
                    const leafGeometry = new THREE.IcosahedronGeometry(size, 1);
                    const leafMesh = new THREE.Mesh(leafGeometry, material);

                    const offsetX = (Math.random() - 0.5) * size * 0.8;
                    const offsetZ = (Math.random() - 0.5) * size * 0.8;
                    leafMesh.position.set(offsetX, 1.8 * randomScale + (Math.random() * 0.5), offsetZ);

                    // Achatando um pouco para ficar mais largo/arredondado
                    leafMesh.scale.set(1, 0.7 + Math.random() * 0.4, 1);

                    treeGroup.add(leafMesh);
                }

                vegMesh = treeGroup;
            } else {
                const bushGroup = new THREE.Group();
                const numSpheres = Math.floor(Math.random() * 3) + 2;

                for (let j = 0; j < numSpheres; j++) {
                    const sphereSize = (0.6 + Math.random() * 0.4) * randomScale;
                    const sphereGeometry = new THREE.SphereGeometry(sphereSize, 6, 5);
                    const sphereMesh = new THREE.Mesh(sphereGeometry, createBushMaterial());

                    sphereMesh.position.set(
                        (Math.random() - 0.5) * 0.5,
                        sphereSize * 0.7,
                        (Math.random() - 0.5) * 0.5
                    );
                    bushGroup.add(sphereMesh);
                }

                vegMesh = bushGroup;
            }

            vegMesh.rotation.y = Math.random() * Math.PI;

            // Ajustar altura para o relevo do terreno
            const raycaster = new THREE.Raycaster();
            const down = new THREE.Vector3(0, -1, 0);
            raycaster.set(new THREE.Vector3(posX, 500, posZ), down);
            const intersects = raycaster.intersectObject(this.ground);
            if (intersects.length > 0) {
                vegMesh.position.set(posX, intersects[0].point.y, posZ);
                vegetationGroup.add(vegMesh);
            }

            vegMesh.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        }

        this.scene.add(vegetationGroup);
    }

    createPlane() {
        this.airplane = createPlayerPlane(this.scene);
        this.airplane.position.set(0, 100, -300);
    }

    createClouds() {
        const cloudMaterial = new THREE.MeshLambertMaterial({
            color: '#fcfcfc',
            transparent: true,
            opacity: 0.3,
            flatShading: true
        });

        for (let i = 0; i < 15; i++) {
            const cloudGroup = new THREE.Group();

            // Criar núcleo da nuvem mais simples
            const mainSphereSize = Math.random() * 3 + 2;
            const mainSphere = new THREE.Mesh(
                new THREE.SphereGeometry(mainSphereSize, 6, 8),
                cloudMaterial
            );
            cloudGroup.add(mainSphere);

            // Apenas 2-3 detalhes por nuvem
            const numDetails = Math.floor(Math.random() * 2) + 2;
            for (let j = 0; j < numDetails; j++) {
                const detailSize = mainSphereSize * (Math.random() * 0.6 + 0.4);
                const detail = new THREE.Mesh(
                    new THREE.SphereGeometry(detailSize, 5, 8),
                    cloudMaterial
                );

                detail.position.set(
                    (Math.random() - 0.5) * mainSphereSize,
                    (Math.random() - 0.5) * mainSphereSize * 0.9,
                    (Math.random() - 0.5) * mainSphereSize
                );
                cloudGroup.add(detail);
            }

            cloudGroup.position.set(
                Math.random() * 200 - 100,
                Math.random() * 20 + 25,
                Math.random() * 200 - 100
            );

            this.scene.add(cloudGroup);
        }
    }

    spawnTrailParticle(position) {
        const size = 0.01 + Math.random() * 0.01;
        const geom = new THREE.SphereGeometry(size, 4, 4);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xeef5fc,
            transparent: true,
            opacity: 0.3,

            depthWrite: false
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(position);
        this.scene.add(mesh);

        this.wingTrailParticles.push({
            mesh: mesh,
            age: 0,
            maxAge: 5,
            initialOpacity: 0.1
        });
    }

    updateWingTrails() {
        if (!this.wingTrailParticles) return;
        for (let i = this.wingTrailParticles.length - 1; i >= 0; i--) {
            const p = this.wingTrailParticles[i];
            p.age++;

            const progress = p.age / p.maxAge;
            p.mesh.material.opacity = p.initialOpacity * (1 - progress);

            const scale = 1 + progress * 2;
            p.mesh.scale.setScalar(scale);

            if (p.age >= p.maxAge) {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.wingTrailParticles.splice(i, 1);
            }
        }
    }

    createCrosshair() {
        this.crosshair = document.createElement('div');
        this.crosshair.id = 'crosshair';
        this.crosshair.style.position = 'absolute';
        this.crosshair.style.top = '50%';
        this.crosshair.style.left = '50%';
        this.crosshair.style.transform = 'translate(-50%, -50%)';
        this.crosshair.style.width = '40px';
        this.crosshair.style.height = '40px';
        this.crosshair.style.pointerEvents = 'none';
        this.crosshair.style.display = 'none';
        this.crosshair.style.zIndex = '1000';

        this.crosshair.innerHTML = `
            <svg viewBox="0 0 100 100" width="100%" height="100%">
                <circle cx="50" cy="50" r="3" fill="#0e0f0fff" opacity="0.9" />
                <circle cx="50" cy="50" r="18" fill="none" stroke="#3e4140ff" stroke-width="1.5" stroke-dasharray="4,6" opacity="0.6" />
                <line x1="50" y1="12" x2="50" y2="28" stroke="#ddf506ff" stroke-width="2" opacity="0.8" />
                <line x1="50" y1="88" x2="50" y2="72" stroke="#eaee12ff" stroke-width="2" opacity="0.8" />
                <line x1="12" y1="50" x2="28" y2="50" stroke="#e3f114ff" stroke-width="2" opacity="0.8" />
                <line x1="88" y1="50" x2="72" y2="50" stroke="#cecb0dff" stroke-width="2" opacity="0.8" />
            </svg>
        `;
        document.body.appendChild(this.crosshair);
    }

    updateCrosshairVisibility() {
        if (this.crosshair) {
            this.crosshair.style.display = this.cameraMode === 'cockpit' ? 'block' : 'none';
        }
    }

    updateHUD() {
        document.getElementById('speed').textContent = Math.round(this.planeState.speed * 40);
        document.getElementById('altitude').textContent = Math.round(this.planeState.altitude * 5);
        document.getElementById('fuel').textContent = Math.round(this.planeState.fuel);

        const fuelBar = document.getElementById('fuelBar');
        if (fuelBar) {
            fuelBar.style.width = `${this.planeState.fuel}%`;
        }

        // Atualiza informações da missão
        if (this.missionNumberElement) {
            this.missionNumberElement.textContent = this.missionManager.currentMission + 1;
        }
        if (this.targetsHitElement) {
            // Alvos acertados = total de alvos - alvos restantes
            const targetsHit = this.missionManager.targetsPerMission - this.missionManager.targets.length;
            this.targetsHitElement.textContent = targetsHit;
        }
        if (this.targetsTotalElement) {
            this.targetsTotalElement.textContent = this.missionManager.targetsPerMission;
        }
        if (this.missionStatusElement) {
            const isComplete = this.missionManager.targets.length === 0;
            this.missionStatusElement.classList.toggle('complete', isComplete);
        }
        if (this.enemyManager && this.enemyManager.scoreDisplay) {
            // Soma a pontuação das missões + a pontuação de inimigos (tiros e destruição)
            let totalScore = 0;
            this.missionManager.missionStats.forEach(stats => {
                totalScore += stats.score;
            });
            totalScore += this.missionManager.currentStats.score;
            totalScore += this.enemyManager.score; // Inclui pontos de aviões inimigos
            this.enemyManager.scoreDisplay.textContent = totalScore;
        }
    }

    setupControls() {
        const startEngineAudioOnce = () => {
            if (!this.engineAudioStarted) {
                this.startEngineAudio();
            }
        };

        window.addEventListener('keydown', startEngineAudioOnce, { once: true });
        window.addEventListener('pointerdown', startEngineAudioOnce, { once: true });

        window.addEventListener('keydown', (event) => {
            if (event.code === 'KeyZ') {
                const now = performance.now();
                if (this.lastShotTime && now - this.lastShotTime < 150) {
                    return;
                }
                this.lastShotTime = now;

                // Get forward direction from airplane's world matrix
                const forward = new THREE.Vector3();
                this.airplane.getWorldDirection(forward);

                // Get position slightly in front of the airplane
                const shootPosition = this.airplane.position.clone();
                shootPosition.add(forward.clone().multiplyScalar(1));

                // Create shooting direction using the forward vector
                const shootDirection = forward.normalize();

                this.enemyManager.shoot(
                    shootPosition,
                    shootDirection
                );
                this.playShotgunSound();
                // Tranco leve e discreto ao disparar as próprias armas
                this.startCameraShake(0.03, 2);
                this.cockpitShake = { frames: 2, totalFrames: 2, intensity: 0.04 };
            }
        });

        window.addEventListener('keydown', (event) => {
            if (event.key === 'v' || event.key === 'V') {
                this.cameraMode = this.cameraMode === 'thirdPerson' ? 'cockpit' : 'thirdPerson';
                this.cockpitInitialized = false;
                this.updateCrosshairVisibility();
            }
        });


        const keyStates = {
            ArrowUp: false,
            ArrowDown: false,
            ArrowLeft: false,
            ArrowRight: false,
            ' ': false,
            x: false
        };

        document.addEventListener('keydown', (event) => {
            if (keyStates.hasOwnProperty(event.key)) {
                keyStates[event.key] = true;
                this.updatePlaneStateFromKeys(keyStates);
            }
        });

        document.addEventListener('keyup', (event) => {
            if (keyStates.hasOwnProperty(event.key)) {
                keyStates[event.key] = false;
                this.updatePlaneStateFromKeys(keyStates);
            }
        });
    }

    // New method to handle continuous key presses
    updatePlaneStateFromKeys(keyStates) {
        // Update turning flags based on current key state
        this.planeState.isTurningLeft = keyStates.ArrowLeft;
        this.planeState.isTurningRight = keyStates.ArrowRight;
        this.planeState.isPitchingUp = keyStates.ArrowDown; // Seta para baixo = Nariz para cima (climb)
        this.planeState.isPitchingDown = keyStates.ArrowUp; // Seta para cima = Nariz para baixo (dive)

        // Handle speed changes (optional: could be instant or gradual)
        // --- Corrected speed increase/decrease logic ---
        const maxSpeed = 20; // Define a maximum speed limit
        const minSpeed = 0;  // Permite parar totalmente
        const speedChangeAmount = 0.08; // Use a smaller increment for gradual change

        if (keyStates.x) { // Spacebar to increase speed
            this.planeState.speed = Math.min(this.planeState.speed + speedChangeAmount, maxSpeed);
        }
        if (keyStates[' ']) { // X key to decrease speed
            this.planeState.speed = Math.max(this.planeState.speed - speedChangeAmount, minSpeed);
        }
        // --- End speed logic correction ---

    }

    setupEngineAudio() {
        this.engineAudio = new Audio('/continuo.mp3');
        this.engineAudio.loop = true;
        this.engineAudio.volume = 0.60;
        this.engineAudio.preload = 'auto';
        this.engineAudio.playbackRate = 1;
        this.engineAudio.preservesPitch = false;
        this.engineAudio.mozPreservesPitch = false;
        this.engineAudio.webkitPreservesPitch = false;
    }

    startEngineAudio() {
        if (!this.engineAudio) return;
        this.engineAudioStarted = true;
        this.updateEngineAudio();
        this.engineAudio.play().catch(() => {
            this.engineAudioStarted = false;
        });
    }

    updateEngineAudio() {
        if (!this.engineAudio || !this.planeState) return;
        const minSpeed = 0;
        const maxSpeed = 20;
        const minRate = 0.6;
        const maxRate = 1.5;
        const normalizedSpeed = THREE.MathUtils.clamp((this.planeState.speed - minSpeed) / (maxSpeed - minSpeed), 0, 1);
        this.engineAudio.playbackRate = THREE.MathUtils.lerp(minRate, maxRate, normalizedSpeed);
    }

    stopEngineAudio() {
        if (!this.engineAudio) return;
        this.engineAudio.pause();
        this.engineAudio.currentTime = 0;
        this.engineAudioStarted = false;
    }

    createGameOverScreen() {
        // Usar o gameOverScreen existente em vez de criar um novo
        this.gameOverScreen = document.getElementById('gameOverScreen');
        this.finalScoreElement = document.getElementById('finalScore');
    }

    showGameOverScreen() {
        if (!this.gameOverDisplayed) {
            this.gameOverDisplayed = true;
            this.stopEngineAudio();
            if (this.gameOverScreen) {
                // Update the final score
                if (this.finalScoreElement) {
                    this.finalScoreElement.textContent = `Pontuação Final: ${this.enemyManager.score}`;
                }

                // Show the game over screen
                this.gameOverScreen.style.display = 'flex';

                // Add the visible class after a small delay to trigger the fade-in animation
                setTimeout(() => {
                    this.gameOverScreen.classList.add('visible');
                }, 100);
            }
        }
    }



    restartGame() {
        // Resetar variáveis do jogo e estatísticas de voo
        this.gameOver = false;
        this.gameOverDisplayed = false;
        this.finalAnalysisDisplayed = false;
        this.gameStarted = false;
        this.playerHealth = 100;
        this.hasFlew = false;
        this.hasTouchdownData = false;
        this._wasOnGround = true;
        this.touchdownSpeed = 0;
        this.touchdownXDiff = 0;
        this.touchdownPitch = 0;
        this.touchdownRoll = 0;
        this.cameraShake = { frames: 0, totalFrames: 0, intensity: 0 };
        this.cockpitShake = { frames: 0, totalFrames: 0, intensity: 0 };

        // Resetar posição e rotação inicial do avião (como no início do jogo em createPlane)
        this.airplane.position.set(0, 100, -300);
        this.airplane.rotation.set(0, 0, 0);
        this.planeState = {
            speed: 9,
            altitude: 100,
            fuel: 100,
            rotation: 0,
            pitch: 0,
            roll: 0,
            isTurningLeft: false,
            isTurningRight: false,
            isPitchingUp: false,
            isPitchingDown: false
        };
        this.landingStopStartTime = null;

        // Limpar wing trails existentes
        if (this.wingTrailParticles) {
            this.wingTrailParticles.forEach(p => {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
            });
            this.wingTrailParticles = [];
        }

        this.landingActionTriggered = false;
        this.updateEngineAudio();

        // Resetar cidade (restaurar prédios destruídos)
        if (this.cityManager) {
            this.cityManager.reset();
        }

        // Limpar inimigos e resetar score
        this.enemyManager.reset();

        // Limpar tanques
        this.tankManager.reset();

        // Limpar baterias antiaéreas
        this.antiAircraftManager.reset();
        this.antiAircraftManager.initBatteries(this.cityManager);

        // Resetar sistema de missões
        this.missionManager.reset();

        this.updateHealthBar(); // Resetar a barra de vida visualmente
        this.updateHUD(); // Atualizar HUD visualmente

        // Esconder tela de game over se visível
        const gameOverScreen = document.getElementById('gameOverScreen');
        if (gameOverScreen) {
            gameOverScreen.classList.remove('visible');
            setTimeout(() => {
                gameOverScreen.style.display = 'none';
            }, 500);
        }

        // Esconder mensagem de pouso
        if (this.landingMessage) {
            this.landingMessage.style.display = 'none';
        }
        this.stopEngineAudio();

        // Criar novos inimigos e tanques para a primeira fase
        this.enemyManager.spawnInitialEnemies(this.airplane.position);

        for (let i = 0; i < this.tankManager.tanksPerPhase; i++) {
            this.tankManager.createTank(this.airplane.position);
        }

        // Mostra o modal da primeira missão
        this.showMissionStartScreen(0);
    }



    // Reproduz som de explosão
    playExplosionSound() {
        const audio = new Audio('/explosion-boa.mp3');
        audio.volume = 0.5;
        audio.play();
    }
    // Reproduz som de tiro do avião do jogador
    playShotgunSound() {
        const audio = new Audio('/tiro.mp3');
        audio.volume = 0.5;
        audio.play();
    }

    // Inicia o "tranco" na câmera
    startCameraShake(intensity = 18, frames = 6) {
        this.cameraShake.intensity = intensity;
        this.cameraShake.frames = frames;
        this.cameraShake.totalFrames = frames;
    }

    animate() {
        if (!this.gameStarted) {
            this.composer.render();
            requestAnimationFrame(() => this.animate());
            return;
        }

        if (this.gameOver) {
            if (!this.finalAnalysisDisplayed) {
                this.showGameOverScreen();
            } else {
                this.composer.render();
                requestAnimationFrame(() => this.animate());
            }
            return;
        }

        this.updateEngineAudio();

        // Atualizar projéteis
        this.enemyManager.updateBullets();
        this.tankManager.updateBullets();
        this.antiAircraftManager.updateBullets();

        // Atualizar baterias antiaéreas
        this.antiAircraftManager.updateBatteries(this.airplane.position);

        this.enemyManager.updateEnemies(this.airplane.position);

        // Colisões de aviões inimigos em queda com construções da cidade
        for (let i = this.enemyManager.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemyManager.enemies[i];
            if (enemy && enemy.isDying) {
                const enemyBoundingBox = this.enemyManager.getEnemyBoundingBox(enemy);
                const hitBuilding = this.cityManager.checkPlaneCollision(enemyBoundingBox);
                if (hitBuilding) {
                    // Destrói a construção
                    this.cityManager.destroyBuilding(hitBuilding);

                    // Se for alvo da missão, credita os pontos e avança a missão sem penalidades
                    if (hitBuilding.isTarget) {
                        this.missionManager.checkTargetDestroyed(hitBuilding);
                    }

                    // Explosão e efeitos
                    this.enemyManager.playExplosionSound?.();
                    this.enemyManager.createExplosion(enemy.position.clone(), 1.5);
                    if (this.craterManager) {
                        this.craterManager.createCrater(enemy.position.clone(), 3.5);
                    }

                    // Dá a pontuação de queda ao jogador
                    this.enemyManager.score += 30;
                    this.enemyManager.updateScore();

                    // Remove o inimigo
                    this.enemyManager.removeEnemy(enemy);
                }
            }
        }

        this.enemyManager.checkBulletCollisions();
        /*
        this.tankManager.updateTanks(this.airplane.position);
        */

        // Verificar colisões com projéteis inimigos e do jogador


        // Colisões com a Cidade
        const cityHitIdx = this.cityManager.checkCollisions(
            this.enemyManager.bullets,
            (pos, scale) => {
                this.enemyManager.createExplosion(pos, scale);
                this.playExplosionSound?.();
            },
            (building) => {
                // Prédio destruído - verifica se era alvo
                if (!this.missionManager.checkTargetDestroyed(building)) {
                    this.missionManager.penalizeNonTarget(building);
                }
                console.log(`Prédio destruído!`);
            },
            (building) => {
                this.missionManager.penalizeNonTarget(building);
            }
        );

        if (cityHitIdx !== -1) {
            const bullet = this.enemyManager.bullets[cityHitIdx];
            if (bullet) {
                this.scene.remove(bullet);
                this.enemyManager.bullets.splice(cityHitIdx, 1);
            }
        }

        // Colisões com as Baterias Antiaéreas (projéteis do jogador)
        const batteryHitIdx = this.antiAircraftManager.checkCollisions(
            this.enemyManager.bullets,
            (pos, scale) => {
                this.enemyManager.createExplosion(pos, scale);
                this.playExplosionSound?.();
            },
            (battery) => {
                this.missionManager.currentStats.score += 100; // +100 pontos por bateria destruída
                console.log(`Bateria antiaérea destruída!`);
            }
        );

        if (batteryHitIdx !== -1) {
            const bullet = this.enemyManager.bullets[batteryHitIdx];
            if (bullet) {
                this.scene.remove(bullet);
                this.enemyManager.bullets.splice(batteryHitIdx, 1);
            }
        }

        // Verificar pouso na pista para restaurar vida
        this.checkLanding();



        // --- Detecção de Colisões ---
        // Certificar-se de que a matriz de transformação do avião está atualizada
        const originalVisibility = this.airplane.visible;
        this.airplane.visible = true;
        this.airplane.updateMatrixWorld(true);
        const playerBoundingBox = new THREE.Box3().setFromObject(this.airplane);
        this.airplane.visible = originalVisibility;
        playerBoundingBox.expandByScalar(0.1); // Expandir ligeiramente para colisão mais responsiva

        // Colisões com projéteis das baterias antiaéreas
        for (let i = this.antiAircraftManager.bullets.length - 1; i >= 0; i--) {
            const bullet = this.antiAircraftManager.bullets[i];
            if (playerBoundingBox.containsPoint(bullet.position)) {
                const damage = 10; // Dano por projétil da bateria antiaérea
                this.playerHealth -= damage;
                this.updateHealthBar();
                this.startCameraShake(0.5, 10);
                this.cockpitShake = { frames: 10, totalFrames: 10, intensity: 0.8 };
                this.enemyManager.createExplosion(bullet.position.clone(), 0.3);
                this.scene.remove(bullet);
                this.antiAircraftManager.bullets.splice(i, 1);
                if (this.playerHealth <= 0) {
                    this.gameOver = true;
                    this.showGameOverScreen();
                    return;
                }
            }
        }

        // Colisões com projéteis dos inimigos
        for (let i = this.enemyManager.enemyBullets.length - 1; i >= 0; i--) {
            const bullet = this.enemyManager.enemyBullets[i];

            if (playerBoundingBox.containsPoint(bullet.position)) {
                const damage = 20;
                this.playerHealth -= damage;
                this.updateHealthBar();
                this.startCameraShake(0.7, 12);
                this.cockpitShake = { frames: 12, totalFrames: 12, intensity: 1.0 };
                this.enemyManager.createExplosion(bullet.position.clone(), 0.25);
                this.scene.remove(bullet);
                this.enemyManager.enemyBullets.splice(i, 1);
                if (this.playerHealth <= 0) {
                    this.gameOver = true;
                    this.showGameOverScreen();
                    return;
                }
            }
        }

        // Colisões com projéteis dos tanques 
        for (let i = this.tankManager.tankBullets.length - 1; i >= 0; i--) {
            const bullet = this.tankManager.tankBullets[i];
            if (playerBoundingBox.containsPoint(bullet.position)) {
                const damage = 15;
                this.playerHealth -= damage;
                this.updateHealthBar();
                this.startCameraShake(0.6, 10);
                this.cockpitShake = { frames: 10, totalFrames: 10, intensity: 0.9 };
                this.tankManager.createExplosion(bullet.position.clone());
                this.scene.remove(bullet);
                this.tankManager.tankBullets.splice(i, 1);
                if (this.playerHealth <= 0) {
                    this.gameOver = true;
                    this.showGameOverScreen();
                    return;
                }
            }
        }

        /*
        // Colisão com montanhas
        if (this.mountainsGroup) {
            const forward = new THREE.Vector3();
            this.airplane.getWorldDirection(forward);

            const raycaster = new THREE.Raycaster(this.airplane.position, forward);
            const collisionDistance = 1.5; // Distância de colisão (ajuste conforme necessário)

            for (const mountain of this.mountainsGroup.children) {
                const intersects = raycaster.intersectObject(mountain, true);

                if (intersects.length > 0 && intersects[0].distance < collisionDistance) {
                    this.playerHealth -= 50; // Dano de colisão
                    this.updateHealthBar();
                    console.log('Colisão com montanha!');
                    this.enemyManager.createExplosion(this.airplane.position);

                    if (this.playerHealth <= 0) {
                        this.gameOver = true;
                        this.showGameOverScreen();
                        return; // Sai da função animate
                    }
                    // Para a iteração para evitar dano múltiplo em um único quadro
                    break;
                }
            }
        }
        */

        // Colisões com aeronaves inimigas
        for (let i = this.enemyManager.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemyManager.enemies[i];
            if (enemy && enemy.position) {
                const enemyBoundingBox = this.enemyManager.getEnemyBoundingBox(enemy);
                enemyBoundingBox.expandByScalar(0.1);
                if (!enemy.isDying && playerBoundingBox.intersectsBox(enemyBoundingBox)) {
                    const damage = 75; // Dano alto por colisão com inimigo
                    this.playerHealth -= damage;
                    this.updateHealthBar();
                    console.log('Colisão com aeronave inimiga!');
                    this.enemyManager.createExplosion(this.airplane.position);

                    // Inicia a "espiral da morte" em vez de remover imediatamente
                    this.enemyManager.startEnemyDeathSpiral(enemy);

                    // Mantém a pontuação prevista para colisão
                    this.enemyManager.score += 50; // Pontos por destruir inimigo em colisão
                    this.enemyManager.updateScoreDisplay();

                    if (this.playerHealth <= 0) {
                        this.gameOver = true;
                        this.showGameOverScreen();
                        return;
                    }
                }
            }
        }

        // Colisões do Avião com a Cidade
        const cityBuildingHit = this.cityManager.checkPlaneCollision(playerBoundingBox);
        if (cityBuildingHit) {
            this.playerHealth -= 40;
            this.updateHealthBar();
            console.log(`Colisão com ${cityBuildingHit.type}!`);
            const size = new THREE.Vector3();
            cityBuildingHit.box.getSize(size);
            const scale = (size.x + size.y + size.z) / 10;
            this.enemyManager.createExplosion(this.airplane.position, scale);
            this.cityManager.destroyBuilding(cityBuildingHit);
            if (!this.missionManager.checkTargetDestroyed(cityBuildingHit)) {
                this.missionManager.penalizeNonTarget(cityBuildingHit);
            }

            if (this.playerHealth <= 0) {
                this.gameOver = true;
                this.showGameOverScreen();
                return;
            }
        }

        // --- Ground Collision and Altitude Update using Raycasting ---
        const raycaster = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        raycaster.set(this.airplane.position, down);

        const intersects = raycaster.intersectObjects([this.ground, this.runwayMesh], true);
        let groundAltitude = 0;

        if (intersects.length > 0) {
            const actualGroundY = intersects[0].point.y;
            const distanceToGround = intersects[0].distance;
            this.planeState.altitude = distanceToGround; // Update altitude for HUD

            // Considera "no chão sobre a pista" apenas se altitude < 0.4 e sobre a pista
            let onRunway = false;
            if (distanceToGround < 0.4) {
                // Verifica se está sobre a pista
                // Verifica se está sobre a pista (com margem de segurança extra)
                const planePos = this.airplane.position;
                const runwayPos = new THREE.Vector3();
                this.runwayMesh.getWorldPosition(runwayPos);

                const detectWidth = 14.0; // Pista tem 6.0 de largura visual, com margem de segurança
                const detectLength = 180; // Pista tem 90 de comprimento visual, com margem de segurança

                onRunway = Math.abs(planePos.x - runwayPos.x) < detectWidth / 2 &&
                    Math.abs(planePos.z - runwayPos.z) < detectLength / 2;

                // Se estiver no chão, impede de afundar (ajustado para a escala e altura do terreno/pista)
                const minHeight = actualGroundY + 0.225; // Nivelado (0.9 * escala 0.25)
                if (this.airplane.position.y < minHeight) {
                    this.airplane.position.y = minHeight;
                }

                if (!onRunway) {
                    // Fora da pista: desacelera e penaliza se estiver muito rápido
                    if (distanceToGround < 0.28) {
                        if (this.planeState.speed > 3) {
                            const damage = this.planeState.speed * 5;
                            this.playerHealth -= damage;
                            this.updateHealthBar();
                            this.enemyManager.createExplosion(this.airplane.position, 0.5);
                        }
                        // Desaceleração suave fora da pista
                        this.planeState.speed = Math.max(0, this.planeState.speed - 0.08);
                    }
                }
            }
            // Seta a flag de "no chão" para travar o roll e nivelar o avião
            this._isOnGround = (distanceToGround < 0.24);
            this._currentMinHeight = actualGroundY + 0.225; // Nivelado
            this._onGroundOnRunway = (this._isOnGround && onRunway && this.planeState.speed < 1);
        } else {
            // If no ground is detected below, use absolute Y for altitude as a fallback
            this.planeState.altitude = this.airplane.position.y;
            this._currentMinHeight = -1000;
            this._onGroundOnRunway = false;
        }

        if (this.planeState.altitude > 10) {
            this.hasFlew = true;
        }

        // Detect Touchdown (transition from air to ground)
        if (this._isOnGround && !this._wasOnGround) {
            // Calcula a suavidade do pouso com base no pitch e roll no momento do toque
            const idealPitch = 0.3;
            const pitchDiff = Math.abs(this.planeState.pitch - idealPitch);
            const rollDiff = Math.abs(this.planeState.roll);
            const pitchScore = Math.max(0, 100 - pitchDiff * 150);
            const rollScore = Math.max(0, 100 - rollDiff * 200);
            const smoothnessScore = (pitchScore + rollScore) / 2; // 0 a 100

            // Quanto maior a suavidade (perto de 100), menor e mais sutil é o tremor.
            // Quanto menor a suavidade (perto de 0), mais forte e duradouro é o tremor.
            const smoothnessFactor = smoothnessScore / 100.0;
            const intensity = 0.1 + (1.0 - smoothnessFactor) * 1; // Ajustado de 0.05 + 0.85 para 0.15 + 1.5 para ser bem visível
            const frames = Math.round(30 + (1.0 - smoothnessFactor) * 10); // Ajustado de 25-80 para 30-90 frames

            this.cockpitShake = {
                frames: frames,
                totalFrames: frames,
                intensity: intensity
            };
            console.log(`[POUSO] Suavidade: ${smoothnessScore.toFixed(1)}%, Intensidade: ${intensity.toFixed(2)}, Frames: ${frames}`);

            const runwayPos = new THREE.Vector3();
            this.runwayMesh.getWorldPosition(runwayPos);
            const planePos = this.airplane.position;

            // Check if touchdown was on the runway
            const runwayWidth = 14;
            const runwayLength = 170;
            const onRunwayTouchdown = Math.abs(planePos.x - runwayPos.x) < runwayWidth / 2 &&
                Math.abs(planePos.z - runwayPos.z) < runwayLength / 2;

            if (this.hasFlew && onRunwayTouchdown) {
                this.touchdownSpeed = this.planeState.speed;
                this.touchdownXDiff = Math.abs(planePos.x - runwayPos.x);
                this.touchdownPitch = this.planeState.pitch;
                this.touchdownRoll = this.planeState.roll;
                this.hasTouchdownData = true;
            }
        }
        this._wasOnGround = this._isOnGround;

        // --- Removido o translateZ duplicado que estava aqui ---

        // --- Update Yaw, Pitch, and Roll based on key states ---
        const turnSpeed = 0.01;
        const pitchSpeed = 0.009;
        const maxPitch = 0.9;
        const maxRoll = 0.85;
        const rollLerpFactor = 0.045;


        let targetRoll = 0;

        // Permite yaw (giro do corpo) sempre, mas só aplica roll se não estiver parado na pista
        if (this.planeState.isTurningLeft) {
            this.planeState.rotation += turnSpeed;
            targetRoll = -maxRoll;
        } else if (this.planeState.isTurningRight) {
            this.planeState.rotation -= turnSpeed;
            targetRoll = +maxRoll;
        }
        // Só aplica roll se não estiver no chão (taxiando ou parado)
        if (this._isOnGround) {
            // Nivelamento suave de Roll e Pitch quando no chão
            const levelFactor = 0.08;
            this.planeState.roll = THREE.MathUtils.lerp(this.planeState.roll, 0, levelFactor);

            // Nivela o Pitch gradualmente, especialmente quando está devagar (pouso suave)
            // Mas permite que o bico suba se estiver tentando decolar
            if (!this.planeState.isPitchingUp || this.planeState.speed < 5) {
                this.planeState.pitch = THREE.MathUtils.lerp(this.planeState.pitch, 0, levelFactor * 0.5);
            }
        } else {
            this.planeState.roll = THREE.MathUtils.lerp(this.planeState.roll, targetRoll, rollLerpFactor);
        }

        if (this.planeState.isPitchingUp) {
            this.planeState.pitch = Math.min(this.planeState.pitch + pitchSpeed, maxPitch);
        } else if (this.planeState.isPitchingDown) {
            this.planeState.pitch = Math.max(this.planeState.pitch - pitchSpeed, -maxPitch);
        }

        // Consumo de combustível
        if (this.planeState.fuel > 0 && this.planeState.speed > 0) {
            this.planeState.fuel -= 0.02 * (this.planeState.speed / 100);
            this.planeState.fuel = Math.max(this.planeState.fuel, 0);
        } else if (this.planeState.fuel <= 0) {
            // Mantém a velocidade atual (não desacelera por falta de combustível)
            // Aplica perda de altitude gradual (como gravidade sem motor)
            const gravity = 0.04; // Ajuste para taxa de descida realista
            this.planeState.pitch = Math.max(this.planeState.pitch - 0.005, -0.4); // Pitch down (diminui o pitch)
            // Aplica descida diretamente à posição para simular perda de sustentação
            if (!this._onGroundOnRunway) {
                this.airplane.position.y -= gravity;
            }
            // Impede controles de aceleração, mas permite manobras
            this.planeState.speed = Math.max(this.planeState.speed, 0); // Não permite aceleração
        }

        // --- Lógica de Stall (Perda de sustentação se a velocidade for muito baixa) ---
        const speedKmh = this.planeState.speed * 40;
        if (speedKmh < 350 && !this._isOnGround) {
            // Perda de altitude proporcional ao quanto a velocidade está abaixo do limite
            const stallSeverity = (310 - speedKmh) / 310;
            const stallGravity = 0.09 * stallSeverity;
            this.airplane.position.y -= stallGravity;
        }

        this.airplane.rotation.order = 'YXZ';
        this.airplane.rotation.y = this.planeState.rotation;
        this.airplane.rotation.x = -this.planeState.pitch; // Invertido para que pitch positivo seja nariz para cima
        this.airplane.rotation.z = this.planeState.roll;

        const moveDirection = new THREE.Vector3(0, 0, 1);
        moveDirection.applyQuaternion(this.airplane.quaternion);

        const moveVector = moveDirection.multiplyScalar(this.planeState.speed * 0.023);
        this.airplane.position.add(moveVector);

        // Wing trails generation
        const rollDeg = Math.abs(this.planeState.roll) * (180 / Math.PI);
        if (rollDeg > 25 && !this._isOnGround) {
            const localLeftTip = new THREE.Vector3(-10.28678, 0.01, 0).multiplyScalar(PLANE_SCALE);
            const localRightTip = new THREE.Vector3(10.28678, 0.01, 0).multiplyScalar(PLANE_SCALE);

            this.airplane.updateMatrixWorld(true);
            const leftTip = localLeftTip.clone().applyMatrix4(this.airplane.matrixWorld);
            const rightTip = localRightTip.clone().applyMatrix4(this.airplane.matrixWorld);

            this.spawnTrailParticle(leftTip);
            this.spawnTrailParticle(rightTip);
        }

        // --- Trava de Altitude no Chão (Prevenir movimento em Y) ---
        if (this._isOnGround && this._currentMinHeight !== -1000) {
            const speedKmh = this.planeState.speed * 60;
            // Só permite subir se estiver acima da velocidade de decolagem (300 km/h) e com bico para cima
            const canTakeOff = speedKmh > 300 && this.planeState.pitch > 0.05;

            if (!canTakeOff) {
                // Força a posição Y para o nível do solo diretamente
                this.airplane.position.y = this._currentMinHeight;
            } else {
                // Se estiver decolando, garante que não afunde no chão
                if (this.airplane.position.y < this._currentMinHeight) {
                    this.airplane.position.y = this._currentMinHeight;
                }
            }
        }

        if (this.cameraMode === 'cockpit') {
            this.airplane.visible = false;
            const localNoseOffset = new THREE.Vector3(0, 5.28, 1.5).multiplyScalar(PLANE_SCALE);
            this.airplane.updateMatrixWorld(true);
            const noseWorldPos = localNoseOffset.clone().applyMatrix4(this.airplane.matrixWorld);

            const targetCameraQuat = this.airplane.quaternion.clone();
            const rotationY180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
            targetCameraQuat.multiply(rotationY180);


            // 1. Interpolação padrão para a posição do nariz do avião
            if (!this.cockpitInitialized) {
                this.camera.position.copy(noseWorldPos);
                this.camera.quaternion.copy(targetCameraQuat);
                this.cockpitInitialized = true;
            } else {
                this.camera.position.lerp(noseWorldPos, 0.1);
                this.camera.quaternion.slerp(targetCameraQuat, 0.04);
            }

            // 2. Aplica o tremor cru diretamente na posição e rotação finais da câmera (pós-lerp)
            if (this.cockpitShake.frames > 0 && this.cockpitShake.totalFrames > 0) {
                const t = this.cockpitShake.frames / this.cockpitShake.totalFrames; // decaimento
                const shakeAmount = this.cockpitShake.intensity * t * 0.4;

                const randomOffset = new THREE.Vector3(
                    (Math.random() - 0.5),
                    (Math.random() - 0.5),
                    (Math.random() - 0.5)
                ).multiplyScalar(shakeAmount);
                this.camera.position.add(randomOffset);

                // Shake rotacional (inclinação da cabeça)
                const rotShakeAmount = this.cockpitShake.intensity * 0.05 * t;
                const shakeEuler = new THREE.Euler(
                    (Math.random() - 0.5) * rotShakeAmount,
                    (Math.random() - 0.5) * rotShakeAmount,
                    (Math.random() - 0.5) * rotShakeAmount
                );
                const shakeQuat = new THREE.Quaternion().setFromEuler(shakeEuler);
                this.camera.quaternion.multiply(shakeQuat);

                this.cockpitShake.frames--;
            }
        } else {
            this.airplane.visible = true;
            this.camera.up.set(0, 1, 0);

            // Update camera position to follow the airplane with lerp
            const targetCameraPosition = this.airplane.position.clone().add(this.cameraOffset.clone().applyQuaternion(this.airplane.quaternion));

            this.camera.position.lerp(targetCameraPosition, 0.1);
            this.camera.lookAt(this.airplane.position);

            // Aplica o tremor diretamente na posição final da câmera (pós-lerp) para ser bem perceptível
            if (this.cameraShake.frames > 0 && this.cameraShake.totalFrames > 0) {
                const t = this.cameraShake.frames / this.cameraShake.totalFrames;
                const shakeAmount = this.cameraShake.intensity * t;
                const randomOffset = new THREE.Vector3(
                    (Math.random() - 0.5),
                    (Math.random() - 0.5),
                    (Math.random() - 0.5)
                ).multiplyScalar(shakeAmount);
                this.camera.position.add(randomOffset);

                // Pequeno tremor rotacional na câmera de 3ª pessoa
                const rotShake = (Math.random() - 0.5) * shakeAmount * 0.05;
                this.camera.rotation.z += rotShake;

                this.cameraShake.frames--;
            }
        }

        // Update HUD
        this.updateHUD();



        // Fazer a luz do sol seguir o jogador para sombras constantes
        if (this.sunLight && this.airplane) {
            this.sunLight.position.set(
                this.airplane.position.x + 50,
                this.airplane.position.y + 200,
                this.airplane.position.z + 100
            );
            this.sunLight.target = this.airplane;
        }

        // Atualiza o foco do Depth of Field dinamicamente para o avião
        if (this.bokehPass && this.airplane) {
            this.bokehPass.uniforms['focus'].value = this.camera.position.distanceTo(this.airplane.position);
        }

        // Update wing trails
        this.updateWingTrails();

        // Render the scene using composer
        this.composer.render();

        // Request next frame
        requestAnimationFrame(() => this.animate());
    }



    // A pista de pouso foi definida no início da classe. O método duplicado que ficava aqui foi removido para evitar bugs de sobrescrita.

    createSkyGradient() {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 256;

        const context = canvas.getContext('2d');
        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);

        // Gradient do horizonte para o céu (do claro ao azul mais profundo)
        gradient.addColorStop(0, '#44c0f1'); // Céu mais alto (azul claro)
        gradient.addColorStop(0.5, '#3786ee'); // Horizonte (quase branco/azul muito claro)
        gradient.addColorStop(1, '#076794'); // Próximo ao solo
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        this.scene.background = texture;
    }

    createLandingMessage() {
        this.landingMessage = document.createElement('div');
        this.landingMessage.id = 'landingMessage';
        this.landingMessage.style.position = 'absolute';
        this.landingMessage.style.top = '15%';
        this.landingMessage.style.left = '50%';
        this.landingMessage.style.transform = 'translate(-50%, 0)';
        this.landingMessage.style.color = '#fff';
        this.landingMessage.style.fontSize = '32px';
        this.landingMessage.style.fontWeight = 'bold';
        this.landingMessage.style.textAlign = 'center';
        this.landingMessage.style.textShadow = '0 0 10px #000';
        this.landingMessage.style.display = 'none';
        this.landingMessage.style.pointerEvents = 'none';
        this.landingMessage.style.zIndex = '1000';
        document.body.appendChild(this.landingMessage);
    }



    setupCamera() {
        this.camera.position.copy(this.airplane.position).add(this.cameraOffset);
        this.camera.lookAt(this.airplane.position);
    }

    checkLanding() {
        if (!this.airplane || !this.ground) return;

        // Verificar se está na pista e parado (ou quase parado)
        const planePos = this.airplane.position;
        const runwayPos = this.runwayMesh.position;
        const runwayWidth = 14;
        const runwayLength = 170;

        const onRunway = Math.abs(planePos.x - runwayPos.x) < runwayWidth / 2 &&
            Math.abs(planePos.z - runwayPos.z) < runwayLength / 2;

        const altitude = this.planeState.altitude;
        const isStoppedOnGround = onRunway && altitude < 1.0 && this.planeState.speed <= 0.05;

        if (onRunway && altitude < 1.0) {
            // Recuperar combustível gradualmente ao estar na pista
            if (this.planeState.fuel < 100) {
                this.planeState.fuel = Math.min(100, this.planeState.fuel + 0.5);
                this.updateHUD(); // Alterado de updateFuelHUD para updateHUD
            }

            // Se pousou, recupera combustível e vida
            if (this.planeState.speed < 2) {
                this.planeState.fuel = 100;
                this.updateHUD();
            }

            // Recuperar vida gradualmente ao estar na pista
            if (this.playerHealth < 100) {
                this.playerHealth = Math.min(100, this.playerHealth + 0.2);
                this.updateHealthBar();
            }
        }

        if (isStoppedOnGround) {
            if (!this.landingStopStartTime) {
                this.landingStopStartTime = performance.now();
            }

            if (!this.landingActionTriggered && performance.now() - this.landingStopStartTime >= 1000) {
                this.landingActionTriggered = true;
                if (this.missionManager.isMissionComplete()) {
                    this.completeCurrentMission();
                } else {
                    if (this.hasFlew) {
                        this.missionManager.currentStats.score = Math.max(0, this.missionManager.currentStats.score - 50);
                        this.showLandingGradeModal(false);
                    }
                }
                this.updateHUD();
            }
        } else {
            this.landingStopStartTime = null;
            this.landingActionTriggered = false;
        }
    }

    getTotalScore() {
        // Soma a pontuação das missões com os pontos de combate aéreo
        const missionScore = this.missionManager.missionStats.reduce((total, stats) => total + stats.score, 0);
        return missionScore + this.enemyManager.score;
    }

    // Finaliza a missão atual e mostra o modal
    completeCurrentMission() {
        this.missionManager.completeMission();

        if (this.missionManager.gameOver) {
            this.showFinalMissionAnalysis();
        } else {
            this.showMissionModal();
        }
    }

    showMissionStartScreen(missionIndex) {
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.zIndex = '2000';
        modal.style.overflowY = 'auto';

        let missionTitle = "";
        let missionGoal = "";
        let targetTypeDescription = "";

        if (missionIndex === 0) {
            missionTitle = "MISSION 1: CRITICAL STRIKE";
            missionGoal = "Infiltrate the outskirts and destroy enemy-controlled <b>Power Plants</b> and <b>Water Treatment Plants</b>.";
            targetTypeDescription = "Targets: Floating red spheres above power plants and industrial water tanks.";
        } else if (missionIndex === 1) {
            missionTitle = "MISSION 2: ADMINISTRATIVE ASSAULT";
            missionGoal = "The enemy command has retreated to the city center. Locate and eliminate the <b>City Hall</b> and major <b>Government Buildings</b>.";
            targetTypeDescription = "Targets: Floating red spheres above tall buildings and City Hall.";
        } else {
            missionTitle = "MISSION 3: SUPPORT SWEEP";
            missionGoal = "Clear the invaders' remaining secondary support bases. Locate and neutralize the targeted <b>House</b> complexes.";
            targetTypeDescription = "Targets: Floating red spheres above enemy housing.";
        }

        const controlsHTML = missionIndex === 0 ? `
            <div style="text-align: left; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 20px;">
                <h3 style="margin: 0 0 12px 0; color: #3498db; font-size: 18px; font-weight: bold;">🎮 FLIGHT CONTROLS</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px;">
                    <div><b style="color: #2ecc71;">Down Arrow:</b> Pitch UP (Climb)</div>
                    <div><b style="color: #2ecc71;">Up Arrow:</b> Pitch DOWN (Descend)</div>
                    <div><b style="color: #2ecc71;">Left/Right Arrows:</b> Turn & Roll</div>
                    <div><b style="color: #2ecc71;">X key:</b> Accelerate</div>
                    <div><b style="color: #2ecc71;">Spacebar:</b> Throttle Down / Brake</div>
                    <div><b style="color: #2ecc71;">Z key:</b> Fire Machine Gun</div>
                     <div><b style="color: #c0d312ff;">V key:</b> first-person camera</div>
                </div>
            </div>
        ` : `
            <div style="text-align: left; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 15px; font-size: 13px; opacity: 0.85;">
                💡 <b>Controls Reminder:</b> Arrow keys to maneuver (Down Arrow climbs, Up Arrow descends), <b>X</b> accelerates, <b>Space</b> brakes, and <b>Click/Z</b> fires.
            </div>
        `;

        modal.innerHTML = `
            <div style="background: linear-gradient(180deg, #2c3e50, #1f2d3a); padding: 40px; border-radius: 16px; text-align: center; color: white; width: min(650px, 92vw); box-shadow: 0 0 0 1px rgba(0,255,255,0.25), 0 0 20px rgba(0,255,255,0.4), 0 18px 60px rgba(0,0,0,0.6); border: 1px solid rgba(0,255,255,0.65); display: flex; flex-direction: column; gap: 20px;">
                <div>
                    <div style="font-size: 14px; letter-spacing: 0.15em; color: #3498db; font-weight: bold; margin-bottom: 8px;">COMBAT & FLIGHT SIMULATION</div>
                    <h1 style="margin: 0 0 24px 0; font-size: 36px; text-shadow: 0 0 15px rgba(52,152,219,0.5);">${missionTitle}</h1>
                </div>

                <div style="text-align: left; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 22px;">
                    <h3 style="margin: 0 0 12px 0; color: #f1c40f; font-size: 18px; font-weight: bold;">🎯 MISSION OBJECTIVE</h3>
                    <p style="font-size: 15px; line-height: 1.5; margin: 0 0 12px 0;">${missionGoal}</p>
                    <p style="font-size: 13px; color: #e74c3c; margin: 0; font-weight: bold;">${targetTypeDescription}</p>
                </div>

                ${controlsHTML}

                <button id="startGameBtn" style="margin-top: 10px; padding: 16px 36px; font-size: 18px; font-weight: bold; background-color: #3498db; color: white; border: none; border-radius: 10px; cursor: pointer; box-shadow: 0 10px 20px rgba(52,152,219,0.3); transition: all 0.2s;">
                    CONTINUE
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('startGameBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
            this.gameStarted = true;
            this.startEngineAudio();
        });
    }

    calculateLandingGrade() {
        if (!this.hasTouchdownData) {
            const runwayPos = new THREE.Vector3();
            this.runwayMesh.getWorldPosition(runwayPos);
            this.touchdownXDiff = Math.abs(this.airplane.position.x - runwayPos.x);
            this.touchdownSpeed = this.planeState.speed;
            this.touchdownPitch = this.planeState.pitch;
            this.touchdownRoll = this.planeState.roll;
        }

        const runwayWidth = 14;
        const centralityScore = Math.max(0, 100 - (this.touchdownXDiff / (runwayWidth / 2)) * 100);

        // Ideal speed: 270 km/h to 290 km/h (Raw speed: 6.75 to 7.25)
        const idealSpeedMin = 6.75;
        const idealSpeedMax = 7.25;
        let speedScore = 100;
        if (this.touchdownSpeed < idealSpeedMin) {
            speedScore = Math.max(0, 100 - (idealSpeedMin - this.touchdownSpeed) * 40);
        } else if (this.touchdownSpeed > idealSpeedMax) {
            speedScore = Math.max(0, 100 - (this.touchdownSpeed - idealSpeedMax) * 40);
        }

        const idealPitch = 0.1;
        const pitchDiff = Math.abs(this.touchdownPitch - idealPitch);
        const rollDiff = Math.abs(this.touchdownRoll);

        const pitchScore = Math.max(0, 100 - pitchDiff * 150);
        const rollScore = Math.max(0, 100 - rollDiff * 200);
        const smoothnessScore = (pitchScore + rollScore) / 2;

        const totalGrade = Math.round((centralityScore * 0.4) + (speedScore * 0.3) + (smoothnessScore * 0.3));

        return {
            grade: totalGrade,
            centrality: Math.round(centralityScore),
            speed: Math.round(speedScore),
            smoothness: Math.round(smoothnessScore),
            details: {
                xDiff: this.touchdownXDiff.toFixed(2),
                speed: (this.touchdownSpeed * 40).toFixed(0),
                pitch: (this.touchdownPitch * (180 / Math.PI)).toFixed(1),
                roll: (this.touchdownRoll * (180 / Math.PI)).toFixed(1)
            }
        };
    }

    getLandingGradeHTML(gradeData) {
        let gradeColor = '#2ecc71'; // Excellent (95 and up)
        let gradeText = 'Excellent';
        if (gradeData.grade <= 89) {
            gradeColor = '#e74c3c'; // Poor (89 and below)
            gradeText = 'Poor';
        } else if (gradeData.grade < 95) {
            gradeColor = '#f1c40f'; // Good (90 to 94)
            gradeText = 'Good';
        }

        return `
            <div style="background: linear-gradient(180deg, #2c3e50, #1f2d3a); padding: 34px; border-radius: 14px; text-align: center; color: white; width: min(440px, 90vw); box-shadow: 0 0 0 1px rgba(0,255,255,0.2), 0 0 18px rgba(0,255,255,0.35); border: 1px solid rgba(0,255,255,0.5); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="font-size: 13px; letter-spacing: 0.12em; opacity: 0.9; margin-bottom: 10px;">LANDING EVALUATION</div>
                    <h2 style="margin: 0 0 18px 0; font-size: 32px; color: ${gradeColor};">${gradeText}</h2>
                    
                    <div style="font-size: 14px; opacity: 0.85; margin-bottom: 5px;">LANDING SCORE</div>
                    <div style="font-size: 64px; font-weight: 800; margin: 5px 0 20px 0; color: ${gradeColor}; text-shadow: 0 0 20px rgba(0,255,255,0.2);">${gradeData.grade} / 100</div>

                    <div style="display: flex; flex-direction: column; gap: 12px; text-align: left; margin: 20px 0;">
                        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 13px; font-weight: bold;">Centerline Alignment</div>
                                <div style="font-size: 11px; opacity: 0.7;">Centerline offset: ${gradeData.details.xDiff}m</div>
                            </div>
                            <div style="font-size: 20px; font-weight: bold; color: ${gradeData.centrality >= 80 ? '#2ecc71' : gradeData.centrality >= 50 ? '#f1c40f' : '#e74c3c'};">${gradeData.centrality}%</div>
                        </div>

                        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 13px; font-weight: bold;">Touchdown Speed</div>
                                <div style="font-size: 11px; opacity: 0.7;">Speed: ${gradeData.details.speed} km/h (Target: 270-290)</div>
                            </div>
                            <div style="font-size: 20px; font-weight: bold; color: ${gradeData.speed >= 80 ? '#2ecc71' : gradeData.speed >= 50 ? '#f1c40f' : '#e74c3c'};">${gradeData.speed}%</div>
                        </div>

                        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 13px; font-weight: bold;">Smoothness (Attitude)</div>
                                <div style="font-size: 11px; opacity: 0.7;">Pitch: ${gradeData.details.pitch}° | Roll: ${gradeData.details.roll}°</div>
                            </div>
                            <div style="font-size: 20px; font-weight: bold; color: ${gradeData.smoothness >= 80 ? '#2ecc71' : gradeData.smoothness >= 50 ? '#f1c40f' : '#e74c3c'};">${gradeData.smoothness}%</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    showLandingGradeModal(isMissionEnd = false) {
        const gradeData = this.calculateLandingGrade();
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.zIndex = '2000';

        const gradeHTML = this.getLandingGradeHTML(gradeData);

        modal.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 20px;">
                ${gradeHTML}
                <button id="resumeFlightBtn" style="padding: 14px 26px; font-size: 16px; font-weight: 700; background-color: #2ecc71; color: white; border: none; border-radius: 10px; cursor: pointer; width: min(320px, 80%); box-shadow: 0 10px 20px rgba(46,204,113,0.25);">
                    Take Off & Continue
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('resumeFlightBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
            this.landingStopStartTime = null;
            this.landingActionTriggered = false;
            this.hasTouchdownData = false;
            this.hasFlew = false;
        });
    }

    showMissionModal() {
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.zIndex = '2000';
        modal.style.overflowY = 'auto';
        modal.style.padding = '20px 0';

        const stats = this.missionManager.missionStats[this.missionManager.currentMission - 1];
        const totalScore = this.getTotalScore();
        const gradeData = this.calculateLandingGrade();
        const gradeHTML = this.getLandingGradeHTML(gradeData);

        modal.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 24px; width: 100%;">
                <div style="display: flex; flex-direction: row; gap: 24px; justify-content: center; align-items: stretch; flex-wrap: nowrap; width: 100%; max-width: 1100px; padding: 0 20px;">
                    <!-- Left Card: Mission Debriefing -->
                    <div style="background: linear-gradient(180deg, #2c3e50, #1f2d3a); padding: 34px; border-radius: 14px; text-align: center; color: white; width: min(480px, 90vw); box-shadow: 0 0 0 1px rgba(0,255,255,0.2), 0 0 18px rgba(0,255,255,0.35); border: 1px solid rgba(0,255,255,0.5); display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <div style="font-size: 13px; letter-spacing: 0.12em; opacity: 0.9; margin-bottom: 10px;">COMBAT REPORT</div>
                            <h2 style="margin: 0 0 18px 0; font-size: 32px;">Mission ${stats.missionNumber} Complete</h2>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 18px 0 6px 0;">
                                <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(0,255,255,0.14); border-radius: 10px; padding: 14px;">
                                    <div style="font-size: 12px; opacity: 0.85; letter-spacing: 0.08em;">TARGETS HIT</div>
                                    <div style="font-size: 32px; font-weight: 700; margin-top: 6px; color: #2ecc71;">${stats.hits}</div>
                                </div>
                                <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(0,255,255,0.14); border-radius: 10px; padding: 14px;">
                                    <div style="font-size: 12px; opacity: 0.85; letter-spacing: 0.08em;">MISSES (COLLATERAL)</div>
                                    <div style="font-size: 32px; font-weight: 700; margin-top: 6px; color: #e74c3c;">${stats.misses}</div>
                                </div>
                            </div>
                            <div style="margin: 16px 0 10px 0; font-size: 14px; opacity: 0.9;">Targets neutralized: <b>${stats.hits}</b> / <b>${stats.totalTargets}</b></div>
                            <div style="font-size: 12px; opacity: 0.75; margin-bottom: 8px;">Mission score: ${stats.score}</div>
                            <div style="font-size: 14px; opacity: 0.85;">TOTAL SCORE</div>
                            <div style="font-size: 44px; font-weight: 800; margin: 8px 0 22px 0; color: #f1c40f; text-shadow: 0 0 18px rgba(241,196,15,0.25);">${totalScore}</div>
                        </div>
                    </div>

                    <!-- Right Card: Landing Evaluation -->
                    ${gradeHTML}
                </div>

                <button id="nextMissionBtn" style="padding: 14px 26px; font-size: 16px; font-weight: 700; background-color: #3498db; color: white; border: none; border-radius: 10px; cursor: pointer; width: min(320px, 80%); box-shadow: 0 10px 20px rgba(52,152,219,0.25);">
                    Next Mission
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('nextMissionBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
            this.landingStopStartTime = null;
            this.landingActionTriggered = false;
            this.hasTouchdownData = false;
            this.hasFlew = false;
            this.gameStarted = false;
            this.stopEngineAudio();

            for (let i = 0; i < this.enemyManager.enemiesPerPhase; i++) {
                this.enemyManager.createEnemy(this.airplane.position);
            }

            // Shows next mission modal
            this.showMissionStartScreen(this.missionManager.currentMission);
        });
    }

    showFinalMissionAnalysis() {
        this.finalAnalysisDisplayed = true;
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.zIndex = '2000';
        modal.style.overflowY = 'auto';
        modal.style.padding = '20px 0';

        const totalStats = this.missionManager.getTotalStats();
        const totalScore = this.getTotalScore();
        const gradeData = this.calculateLandingGrade();
        const gradeHTML = this.getLandingGradeHTML(gradeData);

        let missionsHTML = '';
        totalStats.missions.forEach(stats => {
            missionsHTML += `
                <div style="margin: 10px 0; padding: 12px; background-color: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; font-size: 13px;">
                    <h4 style="margin: 0 0 6px 0; font-size: 15px; color: #3498db;">Mission ${stats.missionNumber}</h4>
                    <div style="display: flex; gap: 20px;">
                        <span>Hits: <b>${stats.hits} / ${stats.totalTargets}</b></span>
                        <span>Misses: <b>${stats.misses}</b></span>
                        <span>Score: <b>${stats.score}</b></span>
                    </div>
                </div>
            `;
        });

        modal.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 24px; width: 100%;">
                <div style="display: flex; flex-direction: row; gap: 24px; justify-content: center; align-items: stretch; flex-wrap: nowrap; width: 100%; max-width: 1100px; padding: 0 20px;">
                    <!-- Left Card: Final Analysis -->
                    <div style="background: linear-gradient(180deg, #2c3e50, #1f2d3a); padding: 34px; border-radius: 14px; text-align: center; color: white; width: min(520px, 90vw); box-shadow: 0 0 0 1px rgba(0,255,255,0.22), 0 0 20px rgba(0,255,255,0.35); border: 1px solid rgba(0,255,255,0.55); display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <div style="font-size: 13px; letter-spacing: 0.12em; opacity: 0.9; margin-bottom: 10px;">FINAL DEBRIEFING</div>
                            <h2 style="margin: 0 0 18px 0; font-size: 34px;">Game Over</h2>
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 18px 0;">
                                <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(0,255,255,0.14); border-radius: 10px; padding: 12px;">
                                    <div style="font-size: 11px; opacity: 0.85; letter-spacing: 0.08em;">HITS</div>
                                    <div style="font-size: 24px; font-weight: 800; margin-top: 6px; color: #2ecc71;">${totalStats.totalHits}</div>
                                </div>
                                <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(0,255,255,0.14); border-radius: 10px; padding: 12px;">
                                    <div style="font-size: 11px; opacity: 0.85; letter-spacing: 0.08em;">MISSES</div>
                                    <div style="font-size: 24px; font-weight: 800; margin-top: 6px; color: #e74c3c;">${totalStats.totalMisses}</div>
                                </div>
                                <div style="background: rgba(255,255,255,0.06); border: 1px solid rgba(0,255,255,0.14); border-radius: 10px; padding: 12px;">
                                    <div style="font-size: 11px; opacity: 0.85; letter-spacing: 0.08em;">SCORE</div>
                                    <div style="font-size: 24px; font-weight: 800; margin-top: 6px; color: #f1c40f;">${totalScore}</div>
                                </div>
                            </div>
                            <div style="text-align: left; margin-top: 15px;">
                                <h3 style="margin: 0 0 10px 0; font-size: 16px;">Mission Breakdown</h3>
                                ${missionsHTML}
                            </div>
                        </div>
                    </div>

                    <!-- Right Card: Landing Evaluation -->
                    ${gradeHTML}
                </div>

                <button id="restartGameBtn" style="padding: 14px 26px; font-size: 16px; font-weight: 700; background-color: #e74c3c; color: white; border: none; border-radius: 10px; cursor: pointer; width: min(320px, 80%); box-shadow: 0 10px 20px rgba(231,76,60,0.25);">
                    Restart Game
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('restartGameBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
            this.restartGame();
        });

        this.gameOver = true;
    }

} // End of LandingSimulator class

// Iniciar simulação
const simulator = new LandingSimulator();

// Responsividade
window.addEventListener('resize', () => {
    simulator.camera.aspect = window.innerWidth / window.innerHeight;
    simulator.camera.updateProjectionMatrix();
    simulator.renderer.setSize(window.innerWidth, window.innerHeight);
    if (simulator.composer) {
        simulator.composer.setSize(window.innerWidth, window.innerHeight);
    }
});


