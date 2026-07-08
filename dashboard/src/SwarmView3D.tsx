// Swarm View en 3D temps réel, propulsé par Galacean Engine.
// Chaque nœud est une alvéole-pilier hexagonale ; chaque tâche une cellule du
// rayon posée au sol, colorée par statut ; les ouvrières actives pulsent en
// orbite au-dessus de leur nœud ; un fil lumineux relie une tâche en cours à
// l'alvéole qui la butine. Le moteur (~290 Ko gzip) est chargé à la demande.
//
// Le pont React ↔ moteur est impératif : un contrôleur de scène (`HiveScene`)
// est créé au montage, puis `sync()` est appelé à chaque changement d'état
// pour réconcilier les entités 3D avec le snapshot WebSocket.

import { useEffect, useRef, useState } from 'react';
// `import type` est entièrement effacé à la compilation : ces types Galacean
// donnent la sûreté sans embarquer le moteur dans le bundle initial.
import type { BlinnPhongMaterial, Entity, ModelMesh } from '@galacean/engine';
import type { HiveNode, SubAgent, Task } from '../../src/shared/types';

interface Props {
  tasks: Task[];
  nodes: HiveNode[];
  agentsByTask: Record<string, SubAgent[]>;
}

/** Palette (RGB 0..1) alignée sur le thème « ruche » du dashboard. */
const STATUS_RGB: Record<string, [number, number, number]> = {
  pending: [0.42, 0.37, 0.28],
  ready: [1.0, 0.82, 0.4],
  assigned: [0.9, 0.56, 0.15],
  running: [1.0, 0.62, 0.1],
  done: [0.96, 0.72, 0.23],
  failed: [0.9, 0.31, 0.22],
};

type GalaceanModule = typeof import('@galacean/engine');
type EngineInstance = Awaited<ReturnType<GalaceanModule['WebGLEngine']['create']>>;

/** Contrôleur impératif : possède la scène 3D et la synchronise avec l'état. */
class HiveScene {
  private time = 0;
  private readonly taskCells = new Map<
    string,
    { entity: Entity; material: BlinnPhongMaterial; baseY: number; phase: number; status: string }
  >();
  private readonly nodePillars = new Map<
    string,
    { entity: Entity; material: BlinnPhongMaterial; x: number; z: number; active: boolean }
  >();
  private readonly agentPool = new Map<
    string,
    { entity: Entity; material: BlinnPhongMaterial; phase: number }[]
  >();
  private readonly threads = new Map<
    string,
    { entity: Entity; mesh: ModelMesh; material: BlinnPhongMaterial }
  >();
  private readonly disposables: { destroy(): void }[] = [];
  private readonly hexTask: ModelMesh;
  private readonly hexNode: ModelMesh;
  private readonly agentMesh: ModelMesh;

  constructor(
    private readonly G: GalaceanModule,
    private readonly engine: EngineInstance,
    private readonly root: Entity,
  ) {
    const { PrimitiveMesh } = G;
    // Meshes partagés (une seule allocation GPU réutilisée par toutes les entités).
    this.hexTask = PrimitiveMesh.createCylinder(engine, 0.85, 0.85, 0.34, 6);
    this.hexNode = PrimitiveMesh.createCylinder(engine, 1.0, 1.18, 2.6, 6);
    this.agentMesh = PrimitiveMesh.createSphere(engine, 0.16, 12);
    this.disposables.push(this.hexTask, this.hexNode, this.agentMesh);
  }

  /** Réconcilie la scène 3D avec le dernier snapshot. */
  sync(tasks: Task[], nodes: HiveNode[], agentsByTask: Record<string, SubAgent[]>): void {
    nodes.forEach((n, i) => this.upsertNode(n, i, nodes.length));
    tasks.forEach((t, i) => this.upsertTask(t, i));
    this.updateThreads(tasks);
    this.updateAgents(tasks, nodes, agentsByTask);
    this.prune(new Set(tasks.map((t) => t.id)), new Set(nodes.map((n) => n.id)));
  }

  /**
   * Crée un matériau. `track=true` : sa durée de vie suit celle du contrôleur
   * (détruit au démontage). `track=false` : l'appelant en est responsable et
   * doit le détruire quand l'entité disparaît (fils, dont le nombre varie).
   */
  private material(
    rgb: [number, number, number],
    emissive = 0.25,
    alpha = 1,
    track = true,
  ): BlinnPhongMaterial {
    const { BlinnPhongMaterial, Color } = this.G;
    const mat = new BlinnPhongMaterial(this.engine);
    mat.baseColor = new Color(rgb[0], rgb[1], rgb[2], alpha);
    mat.emissiveColor = new Color(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive, 1);
    if (alpha < 1) mat.isTransparent = true;
    if (track) this.disposables.push(mat);
    return mat;
  }

  /** Retire les alvéoles/cellules dont l'id a disparu du snapshot (libère la VRAM). */
  private prune(taskIds: Set<string>, nodeIds: Set<string>): void {
    for (const [id, rec] of this.taskCells) {
      if (!taskIds.has(id)) {
        rec.entity.destroy();
        rec.material.destroy();
        this.taskCells.delete(id);
      }
    }
    for (const [id, rec] of this.nodePillars) {
      if (!nodeIds.has(id)) {
        for (const agent of this.agentPool.get(id) ?? []) {
          agent.entity.destroy();
          agent.material.destroy();
        }
        this.agentPool.delete(id);
        rec.entity.destroy();
        rec.material.destroy();
        this.nodePillars.delete(id);
      }
    }
  }

  private taskPos(index: number): { x: number; z: number } {
    const col = index % 4;
    const row = Math.floor(index / 4);
    return { x: (col - 1.5) * 2.3 + (row % 2) * 1.15, z: 1.5 + row * 2.1 };
  }

  private nodePos(index: number, count: number): { x: number; z: number } {
    return { x: (index - (count - 1) / 2) * 3.6, z: -4.5 };
  }

  private upsertNode(node: HiveNode, index: number, count: number): void {
    const { MeshRenderer, Color } = this.G;
    const { x, z } = this.nodePos(index, count);
    let rec = this.nodePillars.get(node.id);
    if (!rec) {
      const entity = this.root.createChild(`node-${node.id}`);
      const renderer = entity.addComponent(MeshRenderer);
      renderer.mesh = this.hexNode;
      const material = this.material([0.16, 0.13, 0.09], 0.15);
      renderer.setMaterial(material);
      entity.transform.setPosition(x, 1.3, z);
      entity.transform.setRotation(0, 30, 0);
      rec = { entity, material, x, z, active: false };
      this.nodePillars.set(node.id, rec);
    }
    rec.x = x;
    rec.z = z;
    rec.entity.transform.setPosition(x, 1.3, z);
    const online = node.status === 'online';
    const rgb: [number, number, number] = online ? [0.95, 0.7, 0.22] : [0.28, 0.24, 0.18];
    rec.material.baseColor = new Color(rgb[0], rgb[1], rgb[2], 1);
  }

  private upsertTask(task: Task, index: number): void {
    const { MeshRenderer, Color } = this.G;
    const { x, z } = this.taskPos(index);
    const baseY = 0.18;
    let rec = this.taskCells.get(task.id);
    if (!rec) {
      const entity = this.root.createChild(`task-${task.id}`);
      const renderer = entity.addComponent(MeshRenderer);
      renderer.mesh = this.hexTask;
      const material = this.material(STATUS_RGB.pending!);
      renderer.setMaterial(material);
      entity.transform.setPosition(x, baseY, z);
      rec = { entity, material, baseY, phase: hashPhase(task.id), status: task.status };
      this.taskCells.set(task.id, rec);
    }
    rec.status = task.status;
    rec.entity.transform.setPosition(x, baseY, z);
    const rgb = STATUS_RGB[task.status] ?? STATUS_RGB.pending!;
    const emissive = task.status === 'running' ? 0.6 : task.status === 'done' ? 0.45 : 0.25;
    rec.material.baseColor = new Color(rgb[0], rgb[1], rgb[2], 1);
    rec.material.emissiveColor.set(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive, 1);
  }

  /** Fils lumineux entre une tâche active et l'alvéole qui la butine. */
  private updateThreads(tasks: Task[]): void {
    const active = new Set<string>();
    for (const t of tasks) {
      if (!t.assignedNodeId) continue;
      if (t.status !== 'running' && t.status !== 'assigned') continue;
      const node = this.nodePillars.get(t.assignedNodeId);
      const cellIndex = tasks.indexOf(t);
      if (!node) continue;
      active.add(t.id);
      const from = this.taskPos(cellIndex);
      this.upsertThread(t.id, from.x, from.z, node.x, node.z, t.status === 'running');
    }
    // Retirer les fils dont la tâche n'est plus active — et LIBÉRER leur mesh
    // (VBO GPU) et leur material, sinon chaque cycle running→done fuit en VRAM.
    for (const [id, thread] of this.threads) {
      if (!active.has(id)) {
        thread.entity.destroy();
        thread.mesh.destroy();
        thread.material.destroy();
        this.threads.delete(id);
      }
    }
  }

  private upsertThread(
    id: string,
    fx: number,
    fz: number,
    nx: number,
    nz: number,
    running: boolean,
  ): void {
    const { MeshRenderer, ModelMesh, MeshTopology, Vector3, Color } = this.G;
    let rec = this.threads.get(id);
    if (!rec) {
      const entity = this.root.createChild(`thread-${id}`);
      const renderer = entity.addComponent(MeshRenderer);
      const mesh = new ModelMesh(this.engine);
      // track=false : le fil est éphémère, on gère nous-mêmes sa destruction.
      const material = this.material([1, 0.62, 0.1], 0.9, 1, false);
      renderer.setMaterial(material);
      rec = { entity, mesh, material };
      this.threads.set(id, rec);
    }
    rec.mesh.setPositions([new Vector3(fx, 0.4, fz), new Vector3(nx, 2.6, nz)]);
    rec.mesh.uploadData(false);
    rec.mesh.clearSubMesh();
    rec.mesh.addSubMesh(0, 2, MeshTopology.Lines);
    const renderer = rec.entity.getComponent(MeshRenderer);
    if (renderer) renderer.mesh = rec.mesh;
    const glow = running ? 1 : 0.5;
    rec.material.baseColor = new Color(1, 0.62 * glow, 0.1, 1);
  }

  /** Ouvrières : sphères pulsantes en orbite au-dessus des nœuds actifs. */
  private updateAgents(
    tasks: Task[],
    nodes: HiveNode[],
    agentsByTask: Record<string, SubAgent[]>,
  ): void {
    for (const node of nodes) {
      const activeTasks = tasks.filter(
        (t) => t.assignedNodeId === node.id && (t.status === 'running' || t.status === 'assigned'),
      );
      const reported = activeTasks.flatMap((t) => agentsByTask[t.id] ?? []);
      const desired = Math.min(reported.length > 0 ? reported.length : activeTasks.length, 8);
      const pillar = this.nodePillars.get(node.id);
      if (pillar) pillar.active = desired > 0;

      let pool = this.agentPool.get(node.id);
      if (!pool) {
        pool = [];
        this.agentPool.set(node.id, pool);
      }
      const pos = this.nodePos(nodes.indexOf(node), nodes.length);
      // Crée les sphères manquantes.
      while (pool.length < desired) {
        const { MeshRenderer } = this.G;
        const entity = this.root.createChild(`agent-${node.id}-${pool.length}`);
        const renderer = entity.addComponent(MeshRenderer);
        renderer.mesh = this.agentMesh;
        const material = this.material([1, 0.65, 0.12], 0.8);
        renderer.setMaterial(material);
        pool.push({ entity, material, phase: pool.length * 0.8 });
      }
      // Positionne / (dés)active selon le besoin courant.
      pool.forEach((agent, i) => {
        const on = i < desired;
        agent.entity.isActive = on;
        if (!on) return;
        const angle = (Math.PI * 2 * i) / Math.max(desired, 1);
        agent.entity.transform.setPosition(
          pos.x + Math.cos(angle) * 0.75,
          3.1,
          pos.z + Math.sin(angle) * 0.75,
        );
      });
    }
  }

  /** Appelé chaque frame par le Script d'animation. */
  onFrame(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (const cell of this.taskCells.values()) {
      if (cell.status === 'running') {
        const bob = Math.sin(t * 3 + cell.phase) * 0.18;
        cell.entity.transform.setPosition(
          cell.entity.transform.position.x,
          cell.baseY + 0.25 + bob,
          cell.entity.transform.position.z,
        );
      }
    }
    for (const pool of this.agentPool.values()) {
      for (const agent of pool) {
        if (!agent.entity.isActive) continue;
        const s = 1 + Math.sin(t * 5 + agent.phase) * 0.35;
        agent.entity.transform.setScale(s, s, s);
      }
    }
  }

  dispose(): void {
    // Fils éphémères (non trackés dans disposables) : libérer mesh + material.
    for (const thread of this.threads.values()) {
      try {
        thread.mesh.destroy();
        thread.material.destroy();
      } catch {
        /* déjà libéré */
      }
    }
    this.threads.clear();
    for (const d of this.disposables) {
      try {
        d.destroy();
      } catch {
        /* déjà libéré */
      }
    }
  }
}

export default function SwarmView3D({ tasks, nodes, agentsByTask }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HiveScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dernières props à jour : le moteur met plusieurs centaines de ms à charger ;
  // les snapshots arrivés pendant ce délai seraient perdus si le premier sync
  // utilisait les props figées du montage. On lit ce ref à la fin de l'init.
  const propsRef = useRef({ tasks, nodes, agentsByTask });
  propsRef.current = { tasks, nodes, agentsByTask };

  // Montage : création du moteur + de la scène (une fois).
  useEffect(() => {
    let engine: EngineInstance | null = null;
    let disposed = false;
    let onResize: (() => void) | null = null;

    (async () => {
      try {
        const G = await import('@galacean/engine');
        const { OrbitControl } = await import('@galacean/engine-toolkit-controls');
        const {
          WebGLEngine,
          Camera,
          DirectLight,
          Color,
          Vector3,
          Script,
          DiffuseMode,
          BackgroundMode,
        } = G;

        const created = await WebGLEngine.create({ canvas: canvasRef.current! });
        if (disposed) {
          created.destroy();
          return;
        }
        engine = created;
        engine.canvas.resizeByClientSize();
        const scene = engine.sceneManager.activeScene;
        scene.background.mode = BackgroundMode.SolidColor;
        scene.background.solidColor = new Color(0.09, 0.075, 0.06, 1);
        const ambient = scene.ambientLight;
        ambient.diffuseMode = DiffuseMode.SolidColor;
        ambient.diffuseSolidColor = new Color(0.35, 0.3, 0.24, 1);
        const root = scene.createRootEntity('Root');

        // Caméra + orbite (glisser pour tourner autour de la ruche).
        const camEntity = root.createChild('Camera');
        camEntity.addComponent(Camera);
        camEntity.transform.setPosition(0, 10, 13);
        camEntity.transform.lookAt(new Vector3(0, 1, -1), new Vector3(0, 1, 0));
        const orbit = camEntity.addComponent(OrbitControl);
        orbit.target = new Vector3(0, 1, -1);
        orbit.minDistance = 6;
        orbit.maxDistance = 45;

        // Éclairage. En Galacean 1.6, la lumière n'a pas de champ `intensity` :
        // la puissance se règle via l'amplitude de la couleur (HDR, > 1 permis).
        const lightEntity = root.createChild('Light');
        const dir = lightEntity.addComponent(DirectLight);
        dir.color = new Color(1.1, 1.02, 0.9, 1);
        lightEntity.transform.setRotation(-50, -40, 0);

        const hive = new HiveScene(G, engine, root);
        sceneRef.current = hive;

        // Animation par frame via un composant Script.
        class Animator extends Script {
          onUpdate(deltaTime: number): void {
            hive.onFrame(deltaTime);
          }
        }
        root.addComponent(Animator);

        // Premier rendu avec l'état LE PLUS RÉCENT (pas celui figé au montage).
        const latest = propsRef.current;
        hive.sync(latest.tasks, latest.nodes, latest.agentsByTask);

        onResize = () => engine?.canvas.resizeByClientSize();
        window.addEventListener('resize', onResize);
        engine.run();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      if (onResize) window.removeEventListener('resize', onResize);
      sceneRef.current?.dispose();
      sceneRef.current = null;
      engine?.destroy();
      engine = null;
    };
    // Montage unique : la scène est créée une fois, puis synchronisée par l'effet suivant.
  }, []);

  // Mises à jour : réconcilier la scène à chaque changement d'état.
  useEffect(() => {
    sceneRef.current?.sync(tasks, nodes, agentsByTask);
  }, [tasks, nodes, agentsByTask]);

  if (error) {
    return (
      <div className="swarm3d-error">Rendu 3D indisponible ({error}). Basculez en vue 2D.</div>
    );
  }
  return <canvas ref={canvasRef} className="swarm3d-canvas" />;
}

/** Phase pseudo-aléatoire stable dérivée de l'id (désynchronise les pulsations). */
function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return (h / 1000) * Math.PI * 2;
}
