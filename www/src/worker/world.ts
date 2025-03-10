import { ChunkWorkerChunkManager, ChunkWorkerChunk } from "./chunk.js";
import { VectorCollector, Vector, getChunkAddr, PerformanceTimer } from "../helpers.js";
import {ChunkWorkQueue} from "./ChunkWorkQueue.js";
import type { TerrainMap2 } from "../terrain_generator/biome3/terrain/map.js";
import type { BLOCK } from "../blocks.js";

/** If it's true, it causes the chunk total chunk timers to be printed once after the wueue is empty. */
const DEBUG_CHUNK_GEN_TIMERS = false

// WorkerWorldManager
export class WorkerWorldManager {
    block_manager: BLOCK
    all: Map<string, WorkerWorld>
    list: WorkerWorld[]
    curIndex: number
    terrainGenerators: Map<string, object>

    /**
     * @param { BLOCK } block_manager
     */
    constructor(block_manager : BLOCK, terrainGenerators: Map<string, object>) {
        this.block_manager = block_manager
        this.terrainGenerators = terrainGenerators
        this.all = new Map();
        this.list = [];
        this.curIndex = 0;
    }

    static async loadTerrainGenerators(generator_codes: string[]): Promise<Map<string, object>> {
        // generator_codes = ['biome2', 'city', 'city2', 'flat'];
        const terrainGenerators = new Map();
        const genPromises: Promise<any>[] = [];
        // Load terrain generators
        for(let tg_code of generator_codes) {
            genPromises.push(import(`../terrain_generator/${tg_code}/index.js`).then(module => {
                terrainGenerators.set(tg_code, module.default);
            }));
        }
        await Promise.all(genPromises);
        return terrainGenerators;
    }

    async add(g, seed, world_id) {
        const generator_options = g?.options || {};
        const generator_id = g.id;
        const key = generator_id + '/' + seed;
        if(this.all.has(key)) {
            return this.all.get(key);
        }
        const world = new WorkerWorld(this.block_manager);
        const generator_class = this.terrainGenerators.get(generator_id);
        await world.init(seed, world_id, generator_class, generator_options)
        this.all.set(key, world);
        this.list.push(world);
        return world;
    }

    process({maxMs = 20}) {
        const {list} = this;
        let ind = this.curIndex;
        let looped = 0;
        let start = performance.now();
        let passed = 0;

        if (list.length === 0) {
            return;
        }

        while (passed < maxMs && looped < list.length) {
            let world = list[ind];
            if (world.process({maxMs: maxMs - passed}) > 1) {
                looped = 0;
            } else {
                looped++;
            }
            ind = (ind + 1) % list.length;
            passed = performance.now() - start;
        }
        this.curIndex = ind;
    }
}

// World
export class WorkerWorld {
    [key: string]: any;

    totalChunkTimers = DEBUG_CHUNK_GEN_TIMERS ? new PerformanceTimer() : null

    /**
     * @param { BLOCK } block_manager
     */
     constructor(block_manager: BLOCK) {
        this.block_manager = block_manager
        this.chunks = new VectorCollector();
        this.genQueue = new ChunkWorkQueue(this);
        this.buildQueue = null;
        this.chunkManager = new ChunkWorkerChunkManager(this);
        this.generator = null;
        this.activePotentialCenter = null;
    }

    async init(seed, world_id, generator_class, generator_options) {
        this.generator = new generator_class(this, seed, world_id, generator_options);
        await this.generator.init();
    }

    ensureBuildQueue() {
        if (this.buildQueue) {
            return;
        }
        this.buildQueue = new ChunkWorkQueue(this);
        for (let chunk of this.chunks.values()) {
            if (chunk.inited) {
                chunk.buildVerticesInProgress = true;
                this.buildQueue.push(chunk);
            }
        }
    }

    workerSetBlock(args) {
        const chunk_addr = new Vector(0, 0, 0);
        const pos_world = new Vector(0, 0, 0);
        for(let i = 0; i < args.length; i++) {
            const m = args[i];
            // 1. Get chunk
            getChunkAddr(m.pos.x, m.pos.y, m.pos.z, chunk_addr);
            const chunk = this.getChunk(chunk_addr);
            if(chunk) {
                // 2. Set block
                if(m.type) {
                    chunk.setBlock(m.pos.x, m.pos.y, m.pos.z, m.type, m.is_modify, m.power, m.rotate, null, m.extra_data);
                }
                pos_world.set(m.pos.x - chunk.coord.x, m.pos.y - chunk.coord.y, m.pos.z - chunk.coord.z);
                chunk.setDirtyBlocks(pos_world);
            } else {
                console.error('WorkerWorld.setBlock: chunk not found at addr: ', m.addr);
            }
        }
    }

    createChunk(args) {
        if(this.chunks.has(args.addr)) {
            return this.chunks.get(args.addr);
        }
        let chunk = new ChunkWorkerChunk(this.chunkManager, args);
        this.chunks.add(args.addr, chunk);
        chunk.init();
        this.genQueue.push(chunk);
        // console.log(`Actual chunks count: ${this.chunks.size}`);
    }

    destructChunk(props) {
        const {addr, uniqId} = props;
        const chunk = this.chunks.get(addr);
        if(chunk && chunk.uniqId === uniqId) {
            this.chunks.delete(addr);
            if(chunk.layer) {
                chunk.layer.maps.delete(addr);
            } else {
                this.generator.maps?.delete(addr);
            }
            chunk.destroy();
            return true;
        }
        return false;
    }

    getChunk(addr) {
        return this.chunks.get(addr) || null;
    }

    // Return generator options
    getGeneratorOptions(key, default_value) {
        const generator_options = this.generator.options;
        if(generator_options) {
            if(key in generator_options) {
                return generator_options[key];
            }
        }
        return default_value;
    }

    workerSetPotential(pos: IVector) {
        this.ensureBuildQueue();
        this.checkPotential(new Vector().copyFrom(pos).round());
    }

    checkPotential(npc) {
        // potential was changed, reorder everything
        this.activePotentialCenter = npc;
        this.buildQueue.potentialCenter = npc;
        this.genQueue.potentialCenter = npc;

        this.buildQueue.needSort = true;
        this.genQueue.needSort = true;
    }

    process({maxMs = 20, genPerIter = 16 * 16 * 40 * 2, buildPerIter = 40}) {
        const {buildQueue, genQueue} = this;
        genQueue.relaxEntries();
        const start = performance.now();
        const buildResults = [];

        let loops = 0;
        let totalTimes = 0, totalPages = 0, minGenDist = 10000, minBuildDist = 10000;
        while (performance.now() - start < maxMs && (buildQueue ? buildQueue.size() : 0) + genQueue.size() > 0) {

            loops++;
            let times = 0;
            while (times < genPerIter) {
                const chunk = genQueue.pop();
                if (!chunk) {
                    break;
                }

                chunk.doGen();

                const total = this.totalChunkTimers
                if (total) {
                    total.addFrom(chunk.timers).count++
                    if (genQueue.size() == 0) {
                        console.log(`[ChunkWorker] generated ${total.count} chunks. Times, ms:`)
                        console.log(total.addSum().round().exportMultiline())
                        this.totalChunkTimers = null
                    }
                }

                times += chunk.genValue || genPerIter;
                minGenDist = Math.min(minGenDist, chunk.queueDist);
                // Ticking blocks
                let ticking_blocks = [];
                for(let k of chunk.ticking_blocks.keys()) {
                    ticking_blocks.push(k.toHash());
                }

                if (buildQueue) {
                    buildQueue.push(chunk);
                    chunk.buildVerticesInProgress = true;
                }

                // Return chunk object
                const ci = {
                    key:            chunk.key,
                    addr:           chunk.addr,
                    tblocks:        chunk.tblocks,
                    ticking_blocks: ticking_blocks,
                    map:            chunk.map
                };

                const non_zero = ci.tblocks.refreshNonZero();
                const ci2 = {
                    addr: ci.addr,
                    uniqId: chunk.uniqId,
                    // key: ci.key,
                    tblocks: non_zero > 0 ? ci.tblocks.saveState() : null,
                    ticking_blocks: ci.ticking_blocks,
                    packedCells: chunk.packCells(),
                    genQueueSize: genQueue.size()
                }

                QubatchChunkWorker.postMessage(['blocks_generated', ci2]);
            }

            totalTimes += times;

            if (!buildQueue) {
                continue;
            }

            buildQueue.relaxEntries();

            let pages = 0;
            while (pages < buildPerIter) {
                const chunk = buildQueue.pop();
                if (!chunk) {
                    break;
                }
                minBuildDist = Math.min(minBuildDist, chunk.queueDist);
                chunk.buildVerticesInProgress = false;
                const CHUNK_SIZE_X = chunk.size.x;
                const item = buildVertices(chunk, false);
                pages += chunk.totalPages + 4; // 4 is const for build value generation
                if(item) {
                    item.dirt_colors = new Float32Array(chunk.size.x * chunk.size.z * 2);
                    let index = 0;
                    for(let z = 0; z < chunk.size.z; z++) {
                        for(let x = 0; x < chunk.size.x; x++) {
                            item.dirt_colors[index++] = chunk.map.cells[z * CHUNK_SIZE_X + x].dirt_color.r;
                            item.dirt_colors[index++] = chunk.map.cells[z * CHUNK_SIZE_X + x].dirt_color.g;
                        }
                    }
                    buildResults.push(item);
                    chunk.vertices = null;
                }
            }

            totalPages += pages;
        }
        // if (totalPages + totalTimes > 0) {
            // console.log(`Worker Iter gen=${totalTimes} buildPages=${totalPages}, genMin = ${minGenDist}, buildMin=${minBuildDist}`);
        // }

        if (buildResults.length > 0) {
            QubatchChunkWorker.postMessage(['vertices_generated', buildResults]);
        }
        if (genQueue.size() === 0) {
            if (!genQueue.hitZero) {
                genQueue.hitZero = true;
            } else {
                QubatchChunkWorker.postMessage(['gen_queue_size', {genQueueSize: 0}]);
            }
        }
        return loops;
    }
}

const buildSettings = {
    enableCache : true,
}

class BuildVerticesResult {

    key:            any
    addr:           Vector
    vertices:       any
    gravity_blocks: any[]
    fluid_blocks:   any[]
    timers:         object
    tm:             float
    map:            TerrainMap2
    dirt_colors:    Float32Array

    constructor(key: any, addr: Vector, vertices: any, gravity_blocks: any[], fluid_blocks: any[], timers: PerformanceTimer, tm: float) {
        this.key            = key
        this.addr           = addr
        this.vertices       = vertices
        this.gravity_blocks = gravity_blocks
        this.fluid_blocks   = fluid_blocks
        this.timers         = Object.fromEntries(timers.result.entries())
        this.tm             = tm
    }
}

function buildVertices(chunk : ChunkWorkerChunk, return_map : boolean = false) : BuildVerticesResult {
    let prev_dirty = chunk.dirty;
    chunk.timers.start('build_vertices')
    chunk.dirty = true;
    let is_builded = chunk.buildVertices(buildSettings);
    if(!is_builded) {
        chunk.dirty = prev_dirty;
        return null;
    }
    chunk.timers.stop()
    const resp = new BuildVerticesResult(
        chunk.key,
        chunk.addr,
        chunk.serializedVertices,
        chunk.gravity_blocks,
        chunk.fluid_blocks,
        chunk.timers,
        chunk.tm,
    )
    if(return_map) {
        resp.map = chunk.map;
    }
    return resp;
}