import {ServerChunk} from "./server_chunk.js";
import { WorldTickStat } from "./world/tick_stat.js";
import {CHUNK_STATE, ALLOW_NEGATIVE_Y, CHUNK_GENERATE_MARGIN_Y} from "../www/js/chunk_const.js";
import { PLAYER_STATUS_WAITING_DATA } from "../www/js/constant.js";
import {getChunkAddr, SpiralGenerator, Vector, VectorCollector, SimpleQueue} from "../www/js/helpers.js";
import {FluidWorld} from "../www/js/fluid/FluidWorld.js";
import {FluidWorldQueue} from "../www/js/fluid/FluidWorldQueue.js";
import {ChunkDataTexture} from "../www/js/light/ChunkDataTexture.js";
import {ItemWorld} from "./ItemWorld.js";
import { AABB } from "../www/js/core/AABB.js";
import {DataWorld} from "../www/js/typed_blocks3.js";
import { WorldPortal } from "../www/js/portal.js";
import { BuildingTemplate } from "../www/js/terrain_generator/cluster/building_template.js";

/**
 * Each tick (unloaded_chunks_total * UNLOADED_CHUNKS_SUBSETS) is unloaded
 * probably should depend on lerpLUT or on current tick rate
 * @type {number}
 */
export const UNLOADED_QUEUE_COEFF = 0.002;

async function waitABit() {
    return true;
}

export class ServerChunkManager {

    static STAT_NAMES = ['unload', 'load', 'generate_mobs', 'ticking_chunks', 'delayed_calls', 'dispose']

    constructor(world, random_tickers) {
        this.world                  = world;
        this.worldId                = 'SERVER';
        this.all                    = new VectorCollector();
        this.chunk_queue_load       = new VectorCollector();
        this.chunk_queue_gen_mobs   = new VectorCollector();
        this.ticking_chunks         = new VectorCollector();
        this.chunks_with_delayed_calls = new Set();
        this.invalid_chunks_queue   = [];
        this.disposed_chunk_addrs   = [];
        this.unloaded_chunks_queue  = new SimpleQueue();
        this.unloading_chunks       = new VectorCollector(); // conatins both CHUNK_STATE.UNLOADING and CHUNK_STATE.UNLOADED
        this.unloading_subset_index = 0 // the index of the subset of unloading_chunks that is checked in this tick
        this.unloading_state_count  = 0 // the number of chunks with CHUNK_STATE.UNLOADING
        this.ticks_stat             = new WorldTickStat(ServerChunkManager.STAT_NAMES)
        //
        this.DUMMY = {
            id:         world.block_manager.DUMMY.id,
            name:       world.block_manager.DUMMY.name,
            shapes:     [],
            properties: world.block_manager.DUMMY,
            material:   world.block_manager.DUMMY,
            getProperties: function() {
                return this.material;
            }
        };
        this.dataWorld = new DataWorld(this);
        this.fluidWorld = new FluidWorld(this);
        this.fluidWorld.database = world.db.fluid;
        this.fluidWorld.queue = new FluidWorldQueue(this.fluidWorld);
        this.itemWorld = new ItemWorld(this);
        this.initRandomTickers(random_tickers);
        this.use_light              = true;
        this.chunkDataTexture       = new ChunkDataTexture();
        this.genQueueSize          = 0;
        this.lightProps = {
            texFormat: 'rgba8unorm',
            depthMul: 1,
        }
    }

    // Init worker
    async initWorker() {
        this.worker_inited = false;
        this.worker = new Worker(globalThis.__dirname + '/../www/js/chunk_worker.js');
        const onmessage = (data) => {
            if(data instanceof MessageEvent) {
                data = data.data;
            }
            const cmd = data[0];
            const args = data[1];
            switch(cmd) {
                case 'world_inited': {
                    this.worker_inited = true;
                    this.postWorkerMessage(['buildingSchemaAdd', {list: Array.from(BuildingTemplate.schemas.values())}])
                    this.resolve_worker();
                    break;
                }
                case 'blocks_generated': {
                    let chunk = this.get(args.addr);
                    this.genQueueSize = args.genQueueSize;
                    if(chunk) {
                        chunk.readyPromise = chunk.onBlocksGenerated(args);
                    }
                    break;
                }
                case 'gen_queue_size': {
                    this.genQueueSize = args.genQueueSize;
                    break;
                }
                default: {
                    console.log(`Ignore worker command: ${cmd}`);
                }
            }
        };
        const onerror = (e) => {
            debugger;
        };
        if('onmessage' in this.worker) {
            this.worker.onmessage = onmessage;
            // this.worker.onerror = onerror;
        } else {
            this.worker.on('message', onmessage);
            // this.worker.on('error', onerror);
        }
        const promise = new Promise((resolve, reject) => {
            this.resolve_worker = resolve;
        });
        // Init webworkers
        const world_info = this.world.info;
        const generator = world_info.generator;
        const world_seed = world_info.seed;
        const world_guid = world_info.guid;
        const settings = {texture_pack: null};
        this.postWorkerMessage(['init', {generator, world_seed, world_guid, settings}]);
        return promise;
    }

    onLightWorkerMessage(data) {
        const cmd = data[0];
        const args = data[1];
        switch(cmd) {
            case 'light_generated': {
                let chunk = this.getChunk(args.addr);
                // console.log(`Got light for ${args.addr}`);
                if (!chunk) {
                    chunk = this.unloading_chunks.get(args.addr);
                }
                if(chunk) {
                    if (chunk.uniqId !== args.uniqId) {
                        // This happens occasionally after quick F8.
                        break;
                    }
                    chunk.light.onGenerated(args);
                }
                break;
            }
            case 'ground_level_estimated': {
                that.groundLevelEastimtion = args;
                break;
            }
        }
    }

    async initWorkers(worldId) {
        this.worldId = worldId;
        this.lightWorker = Qubatch.lightWorker;
        this.postLightWorkerMessage([
            'genLayerParams',
            {
                ambientLight: this.world.info.rules.ambientLight || 0,
            }
        ])
    }

    postLightWorkerMessage(msg) {
        if (this.use_light) {
            msg.unshift(this.worldId);
            this.lightWorker.postMessage(msg);
        }
    }

    // postWorkerMessage
    postWorkerMessage(cmd) {
        this.worker.postMessage(cmd);
    }

    // For compatibility with client ChunkManager API
    getWorld() {
        return this.world;
    }

    chunkStateChanged(chunk, old_state, state_id) {
        if (old_state === CHUNK_STATE.UNLOADING) {
            this.unloading_state_count--;
        }
        switch(state_id) {
            case CHUNK_STATE.READY: {
                this.chunk_queue_gen_mobs.set(chunk.addr, chunk);
                break;
            }
            case CHUNK_STATE.UNLOADING:
                this.unloading_state_count++;
                break;
        }
    }

    async tick(tick_number) {
        this.ticks_stat.start();
        this.unloadInvalidChunks();
        this.ticks_stat.add('unload');

        let pn = performance.now();

        // 1. queue chunks for load
        if(this.chunk_queue_load.size > 0) {
            for(const chunk of this.chunk_queue_load.values()) {
                this.chunk_queue_load.delete(chunk.addr);
                if(chunk.load_state === CHUNK_STATE.NEW) {
                    chunk.load();
                }
            }
        }
        // Flush all bulk selects (including those created not in the current call).
        this.world.db.flushBulkSelectQueries();
        this.ticks_stat.add('load');
        // 2. queue chunks for generate mobs
        if(this.chunk_queue_gen_mobs.size > 0) {
            for(const chunk of this.chunk_queue_gen_mobs.values()) {
                this.chunk_queue_gen_mobs.delete(chunk.addr);
                if(chunk.load_state === CHUNK_STATE.READY) {
                    chunk.generateMobs();
                }
            }
        }
        this.ticks_stat.add('generate_mobs');
        // 3. tick for chunks
        if(this.ticking_chunks.size > 0) {
            for(let addr of this.ticking_chunks) {
                if (performance.now() - pn >= 20) {
                    await waitABit();
                    pn = performance.now();
                }

                let chunk = this.get(addr);
                if(!chunk) {
                    this.ticking_chunks.delete(addr);
                    continue;
                }
                chunk.tick(tick_number);
            }
        }
        this.ticks_stat.add('ticking_chunks');
        for(let chunk of this.chunks_with_delayed_calls) {
            if (chunk.isReady()) {
                chunk.executeDelayedCalls();
            }
        }
        this.ticks_stat.add('delayed_calls');
        // 4. Dispose unloaded chunks
        const {unloaded_chunks_queue} = this;
        if (unloaded_chunks_queue.length > 0) {
            let cnt = Math.max(1, unloaded_chunks_queue.length * UNLOADED_QUEUE_COEFF);
            const len = unloaded_chunks_queue.length;
            for (let i = 0; i < len && cnt > 0; i++ ){
                const chunk = unloaded_chunks_queue.shift();
                if (chunk.load_state === CHUNK_STATE.UNLOADED) {
                    chunk.dispose();
                    cnt--;
                }
            }
        }
        if(this.disposed_chunk_addrs.length > 0) {
            this.postWorkerMessage(['destructChunk', this.disposed_chunk_addrs]);
            this.postLightWorkerMessage(['destructChunk', this.disposed_chunk_addrs]);
            this.disposed_chunk_addrs.length = 0;
        }
        this.ticks_stat.add('dispose');
        this.ticks_stat.end();
    }

    // random chunk tick
    randomTick(tick_number) {

        const world_light = this.world.getLight();
        const check_count = Math.floor(this.world.rules.getValue('randomTickSpeed') * 2.5);
        let rtc = 0;

        if(check_count == 0) {
            return
        }

        if(!this.random_chunks || tick_number % 20 == 0)  {
            this.random_chunks = [];
            for(let chunk of this.all) {
                if(!chunk.isReady() || !chunk.tblocks || chunk.randomTickingBlockCount <= 0) {
                    continue;
                }
                this.random_chunks.push(chunk);
            }
        }

        for(let i = 0; i < this.random_chunks.length; i++) {
            if((tick_number % 2) != (i % 2)) {
                continue;
            }
            const chunk = this.random_chunks[i];
            if(chunk.randomTick(tick_number, world_light, check_count * 2)) {
                rtc++;
            }
        }
        if(globalThis.modByRandomTickingBlocks != globalThis.modByRandomTickingBlocks_o) {
            globalThis.modByRandomTickingBlocks_o = globalThis.modByRandomTickingBlocks;
            // console.info(rtc, this.all.size, globalThis.modByRandomTickingBlocks);
        }
    }

    addTickingChunk(addr) {
        this.ticking_chunks.set(addr, addr);
    }

    removeTickingChunk(addr) {
        this.ticking_chunks.delete(addr);
    }

    // Add to invalid queue
    // помещает чанк в список невалидных, т.к. его больше не видит ни один из игроков
    // в следующем тике мира и если chunk.shouldUnload() == false, он будет выгружен методом unloadInvalidChunks()
    invalidate(chunk) {
        this.invalid_chunks_queue.push(chunk);
    }

    unloadInvalidChunks() {
        const invChunks = this.invalid_chunks_queue;
        if(invChunks.length === 0) {
            return false;
        }
        let p = performance.now();

        let cnt = 0;
        for (let i = 0; i < invChunks.length; i++) {
            const chunk = invChunks[i];
            if (chunk.shouldUnload()) {
                if (chunk.load_state <= CHUNK_STATE.LOADING_DATA) {
                    // we didnt even load from database yet
                    this.remove(chunk.addr);
                    chunk.dispose();
                } else if (chunk.load_state === CHUNK_STATE.READY) {
                    invChunks[cnt++] = chunk;
                    this.unloading_chunks.add(chunk.addr, chunk);
                    this.remove(chunk.addr);
                    this.removeTickingChunk(chunk.addr);
                    chunk.onUnload();
                }
            }
        }
        invChunks.length = cnt;
        if (cnt === 0) {
            return false;
        }

        const elapsed1 = Math.round((performance.now() - p) * 10) / 10;
        p = performance.now();

        this.dataWorld.removeChunks(invChunks);
        invChunks.length = 0;

        const elapsed2 = Math.round((performance.now() - p) * 10) / 10;
        console.debug(`Unload invalid chunks: ${cnt}; elapsed: ${elapsed1} ms , ${elapsed2} ms`);
        return true;
    }

    add(chunk) {
        this.chunk_queue_load.set(chunk.addr, chunk);
        this.all.set(chunk.addr, chunk);
    }

    /**
     * Return chunk by addr
     * @param {Vector} addr
     * @returns {ServerChunk}
     */
    get(addr) {
        return this.all.get(addr) || null;
    }

    getChunk(addr) {
        return this.get(addr);
    }

    getOrRestore(addr) {
        let chunk = this.get(addr);
        if (chunk) {
            // found
            return chunk;
        }
        chunk = this.unloading_chunks.get(addr);
        if (!chunk) {
            // not found
            return null;
        }
        // restore
        this.unloading_chunks.delete(addr)
        this.all.set(addr, chunk)
        chunk.restoreUnloaded();
        return chunk;
    }

    getOrAdd(addr) {
        var chunk = this.getOrRestore(addr)
        if (chunk == null) {
            chunk = new ServerChunk(this.world, addr)
            this.add(chunk);
        }
        return chunk;
    }

    // Returns a chunk with load_state === CHUNK_STATE.READY, or null
    getReady(addr) {
        const chunk = this.all.get(addr);
        return chunk && chunk.load_state === CHUNK_STATE.READY ? chunk : null;
    }

    getByPos(pos) {
        return this.get(Vector.toChunkAddr(pos, tmp_getByPos_addrVector));
    }

    getReadyByPos(pos) {
        return this.getReady(Vector.toChunkAddr(pos, tmp_getByPos_addrVector));
    }

    remove(addr) {
        this.chunk_queue_load.delete(addr);
        this.chunk_queue_gen_mobs.delete(addr);
        this.all.delete(addr);
    }

    // Возвращает блок по абслютным координатам
    getBlock(x, y, z) {
        if(x instanceof Vector || typeof x == 'object') {
            y = x.y;
            z = x.z;
            x = x.x;
        }
        let addr = getChunkAddr(x, y, z);
        let chunk = this.all.get(addr);
        if(chunk) {
            return chunk.getBlock(x, y, z);
        }
        return this.DUMMY;
    }

    // chunkSetMobsIsGenerated
    async chunkSetMobsIsGenerated(chunk_addr_hash) {
        return await this.world.db.mobs.chunkMobsSetGenerated(chunk_addr_hash, 1);
    }

    // Return chunks inside AABB
    getInAABB(aabb) {
        const pos1 = getChunkAddr(aabb.x_min, aabb.y_min, aabb.z_min);
        const pos2 = getChunkAddr(aabb.x_max, aabb.y_max, aabb.z_max);
        const aabb2 = new AABB().set(pos1.x, pos1.y, pos1.z, pos2.x, pos2.y, pos2.z).expand(.1, .1, .1);
        const resp = [];
        for(let [chunk_addr, chunk] of this.all.entries(aabb2)) {
            resp.push(chunk);
        }
        return resp;
    }

    chunkUnloaded(chunk) {
        this.unloaded_chunks_queue.push(chunk);
    }

    chunkDisposed(chunk) {
        this.unloading_chunks.delete(chunk.addr);
        this.disposed_chunk_addrs.push({addr: chunk.addr, uniqId: chunk.uniqId});
    }

    // Send command to server worker
    checkDestroyMap() {
        const world = this.world;
        if(world.players.count == 0) {
            return;
        }
        const players = [];
        for(const p of world.players.values()) {
            players.push({
                pos:                p.state.pos,
                chunk_addr:         getChunkAddr(p.state.pos.x, 0, p.state.pos.z),
                chunk_render_dist:  p.state.chunk_render_dist
            });
        }
        this.postWorkerMessage(['destroyMap', { players }]);
    }

    tickChunkQueue(maxQueue) {
        if (this.genQueueSize > maxQueue) {
            return;
        }
        const world = this.world;
        let all = [];
        let waitAddrs = new VectorCollector();
        for(const p of world.players.values()) {
            let waits = p.vision.waitEntries;
            if (p.status === PLAYER_STATUS_WAITING_DATA) {
                waits = p.vision.waitSafeEntries;
            }
            for (let entry of waits) {
                if (this.getOrRestore(entry.pos)) {
                    continue;
                }
                all.push(entry);
            }
        }
        all.sort((a, b) => {
            return a.dist - b.dist;
        })
        let total = 0;
        for (let i = 0; i < all.length && total < maxQueue; i++) {
            const entry = all[i];
            const addr = entry.pos.clone();
            if (waitAddrs.has(addr)) {
                continue;
            }
            waitAddrs.add(addr, addr);
            this.getOrAdd(addr);
            this.genQueueSize ++;
            total++;
        }
    }

    //
    getAround(pos, chunk_render_dist) {
        const world             = this.world;
        const margin            = Math.max(chunk_render_dist + 1, 1);
        const spiral_moves_3d   = SpiralGenerator.generate3D(new Vector(margin, CHUNK_GENERATE_MARGIN_Y, margin));
        const chunk_addr        = Vector.toChunkAddr(pos);
        const _addr             = new Vector(0, 0, 0);
        // array like iterator
        return (function* () {
            for(let i = 0; i < spiral_moves_3d.length; i++) {
                const sm = spiral_moves_3d[i];
                _addr.copyFrom(chunk_addr).addSelf(sm.pos);
                if(ALLOW_NEGATIVE_Y || _addr.y >= 0) {
                    const chunk = world.chunks.get(_addr);
                    if(chunk) {
                        yield chunk;
                    }
                }
            }
        })()
    }

    //
    async initRandomTickers(random_tickers) {
        this.random_tickers = random_tickers;
        this.block_random_tickers = new Map();
        for(const [block_id, block] of this.world.block_manager.list) {
            const ticker = this.random_tickers.get(block.random_ticker ?? '') ?? null;
            if(ticker) {
                this.block_random_tickers.set(block_id, ticker);
            }
        }
    }

    // Returns the horizontally closest safe position for a player.
    // If there are no such positions, returns initialPos.
    findSafePos(initialPos, chunkRenderDist) {
        let startTime = performance.now();
        var bestPos = initialPos;
        var bestDistSqr = Infinity;
        const _this = this;
        const pos = initialPos.floored();
        const initialChunk = this.getReady(Vector.toChunkAddr(pos));
        if (initialChunk == null) {
            return initialPos;
        }
        const chunks = [];
        for(let chunk of this.getAround(pos, chunkRenderDist)) {
            chunks.push(chunk);
        }
        // Gathers chunks with the same (x, z) together.
        // Groups of chunks are sorted by the distance to the central column.
        // Chunks within groups are sorted by decreasing y.
        chunks.sort(function (a, b) {
            const dxa = a.addr.x - initialChunk.addr.x;
            const dza = a.addr.z - initialChunk.addr.z;
            const dxb = b.addr.x - initialChunk.addr.x;
            const dzb = b.addr.z - initialChunk.addr.z;
            var d = (dxa * dxa + dza * dza) - (dxb * dxb + dzb * dzb);
            if (d != 0) {
                return d;
            }
            d = dxa - dxb;
            if (d != 0) {
                return d;
            }
            d = dza - dzb;
            return d != 0 ? d : b.addr.y - a.addr.y;
        });

        function findSafeFloor(chunkIndex, x, z) {
            var chunk = chunks[chunkIndex];
            var topChunkAddr = chunk.addr;
            const pos = new Vector(x, 0, z);
            // 2 blocks above the floor must be passable
            var matPlus2 = _this.DUMMY.material;
            var matPlus1 = _this.DUMMY.material;
            // for each chunk of the column
            do {
                // for each floor block
                for(pos.y = chunk.maxBlockY; pos.y >= chunk.coord.y; --pos.y) {
                    const mat = chunk.getMaterial(pos);
                    // This is the top-most block that looks like some floor.
                    // We don't check any flors below that to avoid spawning in a cave.
                    if (WorldPortal.suitablePortalFloorMaterial(mat) &&
                        (matPlus1.passable || matPlus1.transparent)
                    ) {
                        // check if it's a suitable floor
                        if (matPlus1.passable != 1 ||
                            matPlus2.passable != 1 ||
                            // can spawn in 1-block-deep water
                            _this.fluidWorld.isFluid(pos.x, pos.y + 2, pos.z) ||
                            _this.fluidWorld.isLava(pos.x, pos.y + 1, pos.z)
                        ) {
                            return;
                        }
                        // looks safe
                        const dist = pos.horizontalDistanceSqr(initialPos);
                        if (bestDistSqr > dist) {
                            bestDistSqr = dist;
                            bestPos = pos;
                            // spawn in the middle of a block
                            pos.x += 0.5;
                            pos.y += 1;
                            pos.z += 0.5;
                        }
                        return;
                    }
                    // shift the 2 upper blocks
                    matPlus2 = matPlus1;
                    matPlus1 = mat;
                }
                // go to the chunk below
                ++chunkIndex;
                if (chunkIndex >= chunks.length)
                    return;
                chunk = chunks[chunkIndex];
            } while(chunk.addr.x === topChunkAddr.x && chunk.addr.z === topChunkAddr.z)
        }
        // check the initial pos
        pos.copyFrom(initialPos).flooredSelf();
        findSafeFloor(0, pos.x, pos.z);
        if (bestDistSqr < Infinity) {
            // Don't log fast calls, they take a few ms.
            return bestPos;
        }
        // for each vertical column of chunks
        var topChunkIndex = 0;
        while(topChunkIndex < chunks.length) {
            const chunk = chunks[topChunkIndex];
            const chunkDist = chunk.addr.horizontalDistance(initialChunk.addr);
            // tweak it to change acuracy/performance
            var dxz = Math.min(8, 2 + 2 * Math.floor(chunkDist));
            // for each colum of blocks
            for(var x = chunk.coord.x; x <= chunk.maxBlockX; x += dxz) {
                for(var z = chunk.coord.z; z <= chunk.maxBlockZ; z += dxz) {
                    findSafeFloor(topChunkIndex, x, z);
                }
            }
            /* We find not a globally closest safe position, but a safe position closest
            to the initial position from the 1st chunk colum that has any safe positions.
            It's a compromise between speed and finding the closest safe position. */
            if (bestDistSqr < Infinity) {
                break;
            }
            // skip all the chunks below the top chunk
            do {
                ++topChunkIndex;
            } while(topChunkIndex < chunks.length &&
                chunks[topChunkIndex].addr.x === chunk.addr.x &&
                chunks[topChunkIndex].addr.z === chunk.addr.z)
        }
        let dt = Math.round(performance.now() - startTime);
        console.log(`Finding safe position (${initialPos.x}, ${initialPos.y}, ${initialPos.z}) -> (${bestPos.x}, ${bestPos.y}, ${bestPos.z}); elpased: ${dt} ms`);
        return bestPos;
    }

}

const tmp_getByPos_addrVector       = new Vector();