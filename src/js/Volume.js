// #package js/main

// #include WebGL.js
// #import * as d3 from "d3";

class Volume {

constructor(gl, reader, options) {
    Object.assign(this, {
        ready: false
    }, options);

    this._gl = gl;
    this._reader = reader;

    this.meta       = null;
    this.modalities = null;
    this.blocks     = null;
    this._texture   = null;
}

getValuesForHist(data) {
    let scalar_values = [];
    let gradient_magnitudes = [];
    for (let i = 0; i < data.length; i++){
        if (i%2 === 0){
            scalar_values.push(data[i]);
        } else if (i%2 === 1){
            gradient_magnitudes.push(data[i])
        }
    }
    return {
        scalar: scalar_values,
        gradient: gradient_magnitudes
    };
}

readMetadata(handlers) {
    if (!this._reader) {
        return;
    }
    this.ready = false;
    this._reader.readMetadata({
        onData: data => {
            this.meta = data.meta;
            this.modalities = data.modalities;
            this.blocks = data.blocks;
            handlers.onData && handlers.onData();
        }
    });
}

readModality(modalityName, handlers) {
    if (!this._reader || !this.modalities) {
        return;
    }
    this.ready = false;
    const modality = this.modalities.find(modality => modality.name === modalityName);
    if (!modality) {
        return;
    }
    const dimensions = modality.dimensions;
    const components = modality.components;
    const blocks = this.blocks;

    const gl = this._gl;
    if (this._texture) {
        gl.deleteTexture(this._texture);
    }
    this._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this._texture);

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // TODO: here read modality format & number of components, ...
    let format, internalFormat;
    if (components === 2) {
        internalFormat = gl.RG8;
        format = gl.RG;
    } else {
        internalFormat = gl.R8;
        format = gl.RED;
    }
    gl.texStorage3D(gl.TEXTURE_3D, 1, internalFormat, dimensions.width, dimensions.height, dimensions.depth);
    let remainingBlocks = modality.placements.length;
    let usedData = null
    modality.placements.forEach(placement => {
        this._reader.readBlock(placement.index, {
            onData: data => {
                const position = placement.position;
                const block = blocks[placement.index];
                const blockdim = block.dimensions;
                gl.bindTexture(gl.TEXTURE_3D, this._texture);
                gl.texSubImage3D(gl.TEXTURE_3D, 0,
                    position.x, position.y, position.z,
                    blockdim.width, blockdim.height, blockdim.depth,
                    format, gl.UNSIGNED_BYTE, new Uint8Array(data));
                usedData  = new Uint8Array(data)
                remainingBlocks--;
                if (remainingBlocks === 0) {
                    this.ready = true;
                    handlers.onLoad && handlers.onLoad();
                }
                let values = this.getValuesForHist(usedData)

                const jarray = values.gradient.map(function (item, i) {
                    return [item, values.scalar[i]];
                });
                console.log(jarray)
                let peaks = [];
                for (let i = 0;i< jarray.length;i++) {
                    let is_peak = true
                    let current = jarray[i]
                    if (i <= 4) {
                        for (let j = 0; j < 5; j++) {
                            let compare = jarray[i + j]
                            if (current[0] < compare[0] || current[1] < compare[1]) {
                                is_peak = false
                            }
                            if (!is_peak) break;
                        }
                    } else if (i >= jarray.length - 5) {
                        if (i > jarray.length - 5) continue;
                        for (let j = 4;j>=0;j--){
                            let compare = jarray[i+j]
                            if (current[0] < compare[0] || current[1] < compare[1]){
                                is_peak = false
                            }
                            if (!is_peak) break;
                        }
                    }
                    else {
                        for (let j = -3;j<=3;j++){
                            let compare = jarray[i+j]
                            if (current[0] < compare[0] || current[1] < compare[1]){
                                is_peak = false
                            }
                            if (!is_peak) break;
                        }
                    }
                    if (is_peak){
                        peaks.push(jarray[i])
                    }
                }

                let uniques = [];
                let itemsFound = {};
                for(let i = 0, l = peaks.length; i < l; i++) {
                    let stringified = JSON.stringify(peaks[i]);
                    if(itemsFound[stringified]) { continue; }
                    uniques.push(peaks[i]);
                    itemsFound[stringified] = true;
                }
                console.log(uniques)

                let final = [uniques[0]]
                let threshold_count = 200;
                let threshold = 15;
                let maxP = 3;
                let to_push = [false];
                let counts = new Array(maxP).fill(0);
                for (let i = 1;i< uniques.length;i++){
                    let fin_len = final.length
                    for (let j = 0; j < fin_len;j++){
                        to_push[j] = false
                        if (Math.abs(uniques[i][0] - final[j][0]) >= threshold && Math.abs(uniques[i][1] - final[j][1]) >= threshold && fin_len + 1 <= maxP){
                            to_push[j] = true
                        } else if (Math.abs(uniques[i] - final[j]) < threshold || Math.abs(uniques[i][1] - final[j][1]) < threshold){
                            counts[j] ++;
                        }
                    }
                    if (!to_push.includes(false)){
                        final.push(uniques[i])
                        to_push.push(false)
                    }
                }
                for (let i = 0;i<final.length;i++){
                    if (counts[i] <= threshold_count){
                        final.splice(final.indexOf(i),1)
                    }
                }
                console.log(final)
                console.log(counts)
                this.addHistogram(values);
            }
        });
    });
}

getTexture() {
    if (this.ready) {
        return this._texture;
    } else {
        return null;
    }
}

setFilter(filter) {
    if (!this._texture) {
        return;
    }

    var gl = this._gl;
    filter = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    gl.bindTexture(gl.TEXTURE_3D, this._texture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
}

    addHistogram(values) {
        let histData = [
            {
                x: values.scalar,
                y: values.gradient,
                type: 'histogram2d'

            }
        ];
        let d = document.createElement('div');
        d.setAttribute("id","myDiv");
        d.setAttribute("style", "width:305px;height:250px;");
        d.style.cssFloat="left";
        let elem = document.getElementsByClassName("selected")[1];
        elem.appendChild(d);
        Plotly.newPlot('myDiv', histData);
    }
}
