// Modules
let Vector              = null;
// let BLOCK               = null;
let WorkerWorldManager  = null;
let worlds              = null;
// let world               = null;

const worker = {

    init: function() {
        if(typeof process !== 'undefined') {
            import('fs').then(fs => global.fs = fs);
            import('path').then(module => global.path = module);
            import('worker_threads').then(module => {
                this.parentPort = module.parentPort;
                this.parentPort.on('message', onMessageFunc);    
            });
        } else {
            onmessage = onMessageFunc
        }
    },

    postMessage: function(message) {
        if(this.parentPort) {
            this.parentPort.postMessage(message);
        } else {
            postMessage(message);
        }
    }

}

worker.init();

/**
* @param {string} terrain_type
*/
async function importModules(terrain_type, seed, world_id) {
    // load module
    await import('./helpers.js').then(module => {
        Vector = module.Vector;
    });
    // load module
    await import('./worker/world.js').then(module => {
        WorkerWorldManager = module.WorkerWorldManager;
    });
    // load module
    await import('./blocks.js').then(module => {
        globalThis.BLOCK = module.BLOCK;
        return BLOCK.init();
    });
    //
    worlds = new WorkerWorldManager();
    await worlds.InitTerrainGenerators([terrain_type]);
    globalThis.world = await worlds.add(terrain_type, seed, world_id);
    // Worker inited
    worker.postMessage(['world_inited', null]);
}

// On message callback function
async function onMessageFunc(e) {
    let data = e;
    if(typeof e == 'object' && 'data' in e) {
        data = e.data;
    }
    const cmd = data[0];
    const args = data[1];
    if(cmd == 'init') {
        // Init modules
        let seed = data[2];
        let world_id = data[3];
        return await importModules(args.id, seed, world_id);
    }
    switch(cmd) {
        case 'createChunk': {
            if(world.chunks.has(args.addr)) {
                let chunk = world.chunks.get(args.addr);
                worker.postMessage(['blocks_generated', {
                    key:        chunk.key,
                    addr:       chunk.addr,
                    tblocks:    chunk.tblocks,
                    map:        chunk.map
                }]);
            } else {
                let ci = world.createChunk(args);
                worker.postMessage(['blocks_generated', ci]);
            }
            break;
        }
        case 'destructChunk': {
            world.destructChunk(args.addr);
            break;
        }
        case 'buildVertices': {
            let results = [];
            for(let addr of args.addrs) {
                let chunk = world.chunks.get(addr);
                if(chunk) {
                    // 4. Rebuild vertices list
                    const item = buildVertices(chunk, false);
                    item.dirt_colors = new Float32Array(chunk.size.x * chunk.size.z * 2);
                    let index = 0;
                    for(let z = 0; z < chunk.size.z; z++) {
                        for(let x = 0; x < chunk.size.x; x++) {
                            item.dirt_colors[index++] = chunk.map.info.cells[x][z].biome.dirt_color.r;
                            item.dirt_colors[index++] = chunk.map.info.cells[x][z].biome.dirt_color.g;
                        }
                    }
                    results.push(item);
                    chunk.vertices = null;
                }
            }
            worker.postMessage(['vertices_generated', results]);
            break;
        }
        case 'setBlock': {
            let result = [];
            for(let m of args) {
                // 1. Get chunk
                let chunk = world.chunks.get(m.addr);
                if(chunk) {
                    // 2. Set block
                    if(m.type) {
                        chunk.setBlock(m.x, m.y, m.z, m.type, m.is_modify, m.power, m.rotate, null, m.extra_data);
                    }
                    let pos = new Vector(m.x - chunk.coord.x, m.y - chunk.coord.y, m.z - chunk.coord.z);
                    // 3. Clear vertices for block and around near
                    chunk.setDirtyBlocks(pos);
                    // 4. Rebuild vertices list
                    result.push(buildVertices(chunk, false));
                    chunk.vertices = null;
                } else {
                    console.error('worker.setBlock: chunk not found at addr: ', m.addr);
                }
            }
            // 5. Send result to chunk manager
            worker.postMessage(['vertices_generated', result]);
            break;
        }
        case 'stat': {
            try {
                console.table({
                    maps_cache_count: world.generator.maps_cache.size,
                    maps_cache_size: JSON.stringify(world.generator.maps_cache).length/1024/1024,
                    chunks_count: world.chunks.size,
                });
            } catch(e) {
                console.error(e);
            }
            break;
        }
    }
}

if(typeof process !== 'undefined') {
    import('worker_threads').then(module => module.parentPort.on('message', onMessageFunc));
} else {
    onmessage = onMessageFunc
}

// Rebuild vertices list
function buildVertices(chunk, return_map) {
    chunk.dirty = true;
    chunk.timers.build_vertices = performance.now();
    chunk.buildVertices();
    chunk.timers.build_vertices = Math.round((performance.now() - chunk.timers.build_vertices) * 1000) / 1000;
    let resp = {
        key:                    chunk.key,
        addr:                   chunk.addr,
        vertices:               chunk.vertices,
        gravity_blocks:         chunk.gravity_blocks,
        fluid_blocks:           chunk.fluid_blocks,
        timers:                 chunk.timers,
        tm:                     chunk.tm,
    };
    if(return_map) {
        resp.map = chunk.map.info;
    }
    return resp;
}