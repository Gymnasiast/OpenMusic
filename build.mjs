#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { platform } from 'os';

const verbose = process.argv.indexOf('--verbose') != -1;

async function main() {
    await mkdir('out');
    const objectDirectories = await getContents('replacements', {
        includeDirectories: true
    });
    for (const dir of objectDirectories) {
        await createMusicObject(path.join('replacements', dir));
        await createMusicObject(path.join('additional', dir));
    }
    await createAssetPack('openrct2.music.alternative.json');
    await createAssetPack('openrct2.music.cover.json');
    await createPackage();
    await rm('temp');
}

async function createPackage() {
    const packageFileName = "artifacts/openmusic.zip";
    console.log(`Creating package: ${packageFileName}`);
    const contents = await getContents("out", {
        includeDirectories: true,
        includeFiles: true
    });
    await zip("out", path.join('..', packageFileName), contents);
}

async function createAssetPack(filename) {
    await rm('temp');
    await mkdir('temp');
    const workDir = 'temp';
    const dir = './';

    const root = await readJsonFile(filename);

    console.log(`Creating ${root.id}`);
    let sampleIndex = 0;
    for (let obj of root.objects) {
        for (let i = 0; i < obj.samples.length; i++) {
            const sample = obj.samples[i];
            const newFilename = `${sampleIndex}.ogg`;
            const srcPath = path.join(dir, sample);
            const dstPath = path.join(workDir, newFilename);
            await encodeMusicTrack(dstPath, srcPath);
            obj.samples[i] = newFilename;
            sampleIndex++;
        }
    }

    const outJsonPath = path.join(workDir, 'manifest.json');
    await writeJsonFile(outJsonPath, root);

    const parkapPath = path.join('../out/assetpack', root.id + '.parkap');
    const contents = await getContents(workDir, {
        includeDirectories: true,
        includeFiles: true
    });
    await zip(workDir, parkapPath, contents);
}

async function createMusicObject(dir) {
    await rm('temp');
    await mkdir('temp');
    const workDir = 'temp';

    let root;
    try {
        root = await readJsonFile(path.join(dir, 'object.json'));
    } catch {
        return;
    }

    console.log(`Creating ${root.id}`);

    const tracks = root.properties.tracks;
    for (const track of tracks) {
        const newPath = changeExtension(track.source, '.ogg');
        const srcPath = path.join(dir, track.source);
        const dstPath = path.join(workDir, newPath);
        await encodeMusicTrack(dstPath, srcPath);
        track.source = newPath;
    }

    const outJsonPath = path.join(workDir, 'object.json');
    await writeJsonFile(outJsonPath, root);

    const parkobjPath = path.join('../out/object/official/music', root.id + '.parkobj');
    const contents = await getContents(workDir, {
        includeDirectories: true,
        includeFiles: true
    });
    await zip(workDir, parkobjPath, contents);
}

async function encodeMusicTrack(dstPath, srcPath) {
    await ensureDirectoryExists(dstPath);
    await startProcess(
        'ffmpeg', [
        '-i', srcPath,
        '-acodec', 'libvorbis',
        '-ar', '22050',
        '-ac', '1',
        '-map_metadata', '-1',
        '-y',
        dstPath
    ]);
}

function changeExtension(path, newExtension) {
    const fullStopIndex = path.lastIndexOf('.');
    if (fullStopIndex != -1) {
        return path.substr(0, fullStopIndex) + newExtension;
    }
    return path + newExtension;
}

function readJsonFile(path) {
    return new Promise((resolve, reject) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(JSON.parse(data));
            }
        });
    });
}

function writeJsonFile(path, data) {
    return new Promise((resolve, reject) => {
        const json = JSON.stringify(data, null, 4) + '\n';
        fs.writeFile(path, json, 'utf8', err => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function zip(cwd, outputFile, paths) {
    await ensureDirectoryExists(path.join(cwd, outputFile));
    await rm(path.join(cwd, outputFile));
    if (platform() == 'win32') {
        await startProcess('7z', ['a', '-r', '-tzip', outputFile, ...paths], cwd);
    } else {
        await startProcess('zip', ['-r', outputFile, ...paths], cwd);
    }
}

function startProcess(name, args, cwd) {
    return new Promise((resolve, reject) => {
        const options = {};
        if (cwd) options.cwd = cwd;
        if (verbose) {
            console.log(`Launching \"${name} ${args.join(' ')}\"`);
        }
        const child = spawn(name, args, options);
        let stdout = '';
        child.stdout.on('data', data => {
            stdout += data;
        });
        child.stderr.on('data', data => {
            stdout += data;
        });
        child.on('error', err => {
            if (err.code == 'ENOENT') {
                reject(new Error(`${name} was not found`));
            } else {
                reject(err);
            }
        });
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(`${name} failed:\n${stdout}`));
            } else {
                resolve(stdout);
            }
        });
    });
}

async function ensureDirectoryExists(filename) {
    const dirname = path.dirname(filename);
    await mkdir(dirname);
}

function mkdir(path) {
    return new Promise((resolve, reject) => {
        fs.access(path, error => {
            if (error) {
                if (verbose) {
                    console.log(`Creating directory ${path}`);
                }
                fs.mkdir(path, { recursive: true }, err => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    });
}

function getContents(root, options) {
    return new Promise((resolve, reject) => {
        const results = [];
        let pending = 0;
        const find = (root) => {
            pending++;
            fs.readdir(root, (err, fileNames) => {
                for (const fileName of fileNames) {
                    const fullPath = path.join(root, fileName);
                    pending++;
                    fs.stat(fullPath, (err, stat) => {
                        if (stat) {
                            const result = options.useFullPath === true ? fullPath : fileName;
                            if (stat.isDirectory()) {
                                if (options.includeDirectories === true) {
                                    results.push(result);
                                }
                                if (options.recurse === true) {
                                    find(fullPath);
                                }
                            } else {
                                if (options.includeFiles === true) {
                                    results.push(result);
                                }
                            }
                        }
                        pending--;
                        if (pending === 0) {
                            resolve(results);
                        }
                    });
                }
                pending--;
                if (pending === 0) {
                    resolve(results.sort());
                }
            });
        };
        find(root);
    });
}

function rm(filename) {
    if (verbose) {
        console.log(`Deleting ${filename}`)
    }
    return new Promise((resolve, reject) => {
        fs.stat(filename, (err, stat) => {
            if (err) {
                if (err.code == 'ENOENT') {
                    resolve();
                } else {
                    reject();
                }
            } else {
                if (stat.isDirectory()) {
                    fs.rm(filename, { recursive: true }, err => {
                        if (err) {
                            reject(err);
                        }
                        resolve();
                    });
                } else {
                    fs.unlink(filename, err => {
                        if (err) {
                            reject(err);
                        }
                        resolve();
                    });
                }
            }
        });
    });
}

try {
    await main();
} catch (err) {
    console.log(err.message);
    process.exitCode = 1;
}
