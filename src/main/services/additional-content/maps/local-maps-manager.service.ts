import path from "path";
import { BSVersion } from "shared/bs-version.interface";
import { BsvMapDetail } from "shared/models/maps";
import { BsmLocalMap, BsmLocalMapsProgress, DeleteMapsProgress } from "shared/models/maps/bsm-local-map.interface";
import { BSLocalVersionService } from "../../bs-local-version.service";
import { InstallationLocationService } from "../../installation-location.service";
import { UtilsService } from "../../utils.service";
import crypto, { BinaryLike } from "crypto";
import { lstatSync } from "fs";
import { copy, createReadStream, ensureDir, mkdir, pathExists, pathExistsSync, realpath, unlink, unlinkSync, writeFile } from "fs-extra";
import StreamZip from "node-stream-zip";
import { RequestService } from "../../request.service";
import sanitize from "sanitize-filename";
import { DeepLinkService } from "../../deep-link.service";
import log from "electron-log";
import { WindowManagerService } from "../../window-manager.service";
import { Observable, Subject, Subscriber, lastValueFrom } from "rxjs";
import { Archive } from "../../../models/archive.class";
import { Progression, deleteFolder, ensureFolderExist, getFilesInFolder, getFoldersInFolder, pathExist } from "../../../helpers/fs.helpers";
import { readFile } from "fs/promises";
import { FolderLinkerService } from "../../folder-linker.service";
import { allSettled } from "../../../../shared/helpers/promise.helpers";
import { splitIntoChunk } from "../../../../shared/helpers/array.helpers";
import { SongDetailsCacheService } from "./song-details-cache.service";
import { SongCacheService } from "./song-cache.service";
import { pathToFileURL } from "url";
import { sToMs } from "../../../../shared/helpers/time.helpers";
import { FieldRequired } from "shared/helpers/type.helpers";
import { MapInfo } from "shared/models/maps/info/map-info.model";
import { parseMapInfoDat } from "shared/parsers/maps/map-info.parser";
import { tryit } from "shared/helpers/error.helpers";
import JSZip from "jszip";
import { CustomError } from "shared/models/exceptions/custom-error.class";

export class LocalMapsManagerService {
    private static instance: LocalMapsManagerService;

    public static getInstance(): LocalMapsManagerService {
        if (!LocalMapsManagerService.instance) {
            LocalMapsManagerService.instance = new LocalMapsManagerService();
        }
        return LocalMapsManagerService.instance;
    }

    public static readonly LEVELS_ROOT_FOLDER = "Beat Saber_Data";
    public static readonly CUSTOM_LEVELS_FOLDER = "CustomLevels";
    public static readonly RELATIVE_MAPS_FOLDER = path.join(LocalMapsManagerService.LEVELS_ROOT_FOLDER, LocalMapsManagerService.CUSTOM_LEVELS_FOLDER);
    public static readonly SHARED_MAPS_FOLDER = "SharedMaps";

    private readonly DEEP_LINKS = {
        BeatSaver: "beatsaver",
        ScoreSaber: "web+bsmap",
    };

    private readonly INFO_DAT_REGEX = path.sep === "/"
        ? /(^|\/)(I|i)nfo.dat$/
        : /(^|\\\\)(I|i)nfo.dat$/;

    private readonly localVersion: BSLocalVersionService;
    private readonly installLocation: InstallationLocationService;
    private readonly utils: UtilsService;
    private readonly reqService: RequestService;
    private readonly deepLink: DeepLinkService;
    private readonly windows: WindowManagerService;
    private readonly linker: FolderLinkerService;
    private readonly songDetailsCache: SongDetailsCacheService;
    private readonly songCache: SongCacheService;

    private readonly _lastDownloadedMap = new Subject<{ map: BsmLocalMap, version?: BSVersion }>();

    private constructor() {
        this.localVersion = BSLocalVersionService.getInstance();
        this.installLocation = InstallationLocationService.getInstance();
        this.utils = UtilsService.getInstance();
        this.reqService = RequestService.getInstance();
        this.deepLink = DeepLinkService.getInstance();
        this.windows = WindowManagerService.getInstance();
        this.linker = FolderLinkerService.getInstance();
        this.songDetailsCache = SongDetailsCacheService.getInstance();
        this.songCache = SongCacheService.getInstance();

        const handleOneClick = (mapId: string, isHash = false) => {
            this.windows.openWindow(`oneclick-download-map.html?mapId=${mapId}&isHash=${isHash}`);
        }

        this.deepLink.addLinkOpenedListener(this.DEEP_LINKS.BeatSaver, link => {
            log.info("DEEP-LINK RECEIVED FROM", this.DEEP_LINKS.BeatSaver, link);
            handleOneClick(new URL(link).host);
        });

        this.deepLink.addLinkOpenedListener(this.DEEP_LINKS.ScoreSaber, link => {
            log.info("DEEP-LINK RECEIVED FROM", this.DEEP_LINKS.ScoreSaber, link);
            handleOneClick(new URL(link).host, true);
        });
    }

    public async getMapsFolderPath(version?: BSVersion): Promise<string> {
        if (version) {
            return path.join(await this.localVersion.getVersionPath(version), LocalMapsManagerService.RELATIVE_MAPS_FOLDER);
        }
        const sharedMapsPath = path.join(this.installLocation.sharedContentPath(), LocalMapsManagerService.SHARED_MAPS_FOLDER, LocalMapsManagerService.CUSTOM_LEVELS_FOLDER);
        if (!(await pathExist(sharedMapsPath))) {
            await ensureFolderExist(sharedMapsPath);
        }
        return sharedMapsPath;
    }

    private async computeMapHash(mapPath: string, rawInfoString: string): Promise<string> {
        const { result: mapInfo, error } = tryit(() => parseMapInfoDat(JSON.parse(rawInfoString)));

        if(!mapInfo || error) {
            log.error(`Unable to cumpute hash, cannot parse map info at ${mapPath}`, error);
            throw CustomError.fromError(error, `Unable to cumpute hash, cannot parse map info at ${mapPath}`, "cannot-parse-map-info");
        }

        const shasum = crypto.createHash("sha1");
        shasum.update(rawInfoString);

        const hashFile = (filePath: string): Promise<void> => {
            return new Promise<void>((resolve, reject) => {
                const stream = createReadStream(filePath);
                stream.on("data", data => shasum.update(data as BinaryLike));
                stream.on("error", reject);
                stream.on("close", resolve);
            });
        };

        for (const diff of mapInfo.difficulties) {
            if(diff.beatmapFilename){
                const diffFilePath = path.join(mapPath, diff.beatmapFilename);
                await hashFile(diffFilePath);
            }

            if(diff.lightshowDataFilename) {
                const lightshowFilePath = path.join(mapPath, diff.lightshowDataFilename);
                await hashFile(lightshowFilePath);
            }
        }

        return shasum.digest("hex");
    }

    public async loadMapInfoFromPath(mapPath: string): Promise<BsmLocalMap> {

        const getUrlsAndReturn = (mapInfo: MapInfo, hash: string, mapPath: string): BsmLocalMap => {
            const coverUrl = pathToFileURL(path.join(mapPath, mapInfo.coverImageFilename)).href;
            const songUrl = pathToFileURL(path.join(mapPath, mapInfo.songFilename)).href;
            return { mapInfo, coverUrl, songUrl, hash, path: mapPath, songDetails: this.songDetailsCache.getSongDetails(hash) };
        };

        const cachedMapInfos = this.songCache.getMapInfoFromDirname(path.basename(mapPath));

        if (cachedMapInfos) {
            return getUrlsAndReturn(cachedMapInfos.mapInfo, cachedMapInfos.hash, mapPath);
        }

        const files = await getFilesInFolder(mapPath);
        const infoFile = files.find(file => path.basename(file).toLowerCase() === "info.dat");

        if (infoFile === null) {
            return null;
        }

        const rawInfoString = await readFile(infoFile, { encoding: "utf-8" });
        const { result: mapInfo, error } = tryit(() => parseMapInfoDat(JSON.parse(rawInfoString)));

        if (error) {
            log.error(`Cannot parse map info.dat. Map path: ${mapPath}`, error);
            throw CustomError.fromError(error, `Cannot read map info.dat. Map path: ${mapPath}`, "cannot-parse-map-info");
        }

        const hash = await this.computeMapHash(mapPath, rawInfoString);

        return getUrlsAndReturn(mapInfo, hash, mapPath);
    }

    private async downloadMapZip(zipUrl: string): Promise<{ zip: StreamZip.StreamZipAsync; zipPath: string }> {
        const fileName = `${path.basename(zipUrl, ".zip")}-${crypto.randomUUID()}.zip`;
        const tempPath = this.utils.getTempPath();
        await ensureFolderExist(this.utils.getTempPath());
        const dest = path.join(tempPath, fileName);


        const zipPath = (await lastValueFrom(this.reqService.downloadFile(zipUrl, dest))).data;
        const zip = new StreamZip.async({ file: zipPath });

        return { zip, zipPath };
    }

    public getMaps(version?: BSVersion): Observable<BsmLocalMapsProgress> {
        const progression: BsmLocalMapsProgress = {
            total: 0,
            loaded: 0,
            maps: [],
        };

        return new Observable<BsmLocalMapsProgress>(observer => {
            (async () => {
                await this.songDetailsCache.waitLoaded(sToMs(30));

                const levelsFolder = await this.getMapsFolderPath(version);

                if(!(await pathExist(levelsFolder))) {
                    return observer.complete();
                }

                const levelsPaths =  (await getFoldersInFolder(levelsFolder)) ?? [];
                progression.total = levelsPaths.length;

                const pathChunks = splitIntoChunk(levelsPaths, 50);

                const loadedMaps: BsmLocalMap[] = [];

                for (const chunk of pathChunks) {
                    const mapsInfo = await allSettled(chunk.map(async mapPath => {
                        const mapInfo = await this.loadMapInfoFromPath(mapPath);

                        if(!mapInfo) {
                            return null;
                        }

                        this.songCache.setMapInfoFromDirname(path.basename(mapPath), { mapInfo: mapInfo.mapInfo, hash: mapInfo.hash });

                        progression.loaded++;
                        observer.next(progression);
                        return mapInfo;
                    }), {removeFalsy: true});

                    loadedMaps.push(...(mapsInfo ?? []));
                }

                progression.maps = loadedMaps;

                observer.next(progression);
            })().then(() => {
                observer.complete();
            }).catch(e=> {
                observer.error(e);
            });
        });
    }

    public async versionIsLinked(version: BSVersion): Promise<boolean> {
        const levelsPath = await this.getMapsFolderPath(version);

        const isPathExist = await pathExist(levelsPath);

        if (!isPathExist) {
            return false;
        }

        return lstatSync(levelsPath).isSymbolicLink();
    }

    public async linkVersionMaps(version: BSVersion, keepMaps: boolean): Promise<void> {
        const versionMapsPath = await this.getMapsFolderPath(version);
        return this.linker.linkFolder(versionMapsPath, { keepContents: keepMaps, intermediateFolder: LocalMapsManagerService.SHARED_MAPS_FOLDER });
    }

    public async unlinkVersionMaps(version: BSVersion, keepMaps: boolean): Promise<void> {
        const versionMapsPath = await this.getMapsFolderPath(version);
        return this.linker.unlinkFolder(versionMapsPath, { keepContents: keepMaps, intermediateFolder: LocalMapsManagerService.SHARED_MAPS_FOLDER });
    }

    public deleteMaps(maps: FieldRequired<BsmLocalMap, "path">[]): Observable<DeleteMapsProgress> {
        return new Observable<DeleteMapsProgress>(observer => {
            const progress: DeleteMapsProgress = { total: maps.length, deleted: 0 };

            (async () => {
                for (const map of maps) {
                    const mapPath = map.path;

                    if (pathExistsSync(mapPath)) {
                        await deleteFolder(mapPath);
                        this.songCache.deleteMapInfoFromDirname(path.basename(mapPath));
                        progress.deleted++;
                    }

                    observer.next(progress);
                }
            })()
            .catch(e => observer.error(e))
            .finally(() => observer.complete());
        });
    }

    public deleteMapsFromHashs(version: BSVersion, hashs: string[]): Observable<Progression> {
        return new Observable<Progression>(observer => {
            const progress: Progression = { total: hashs.length, current: 0 };

            (async () => {
                const versionMapsPath = await this.getMapsFolderPath(version);
                const mapsPaths = await getFoldersInFolder(versionMapsPath);

                for (const mapPath of mapsPaths) {
                    const { result: mapInfo } = await tryit(() => this.loadMapInfoFromPath(mapPath));
                    if (mapInfo && hashs.includes(mapInfo.hash)) {
                        await deleteFolder(mapPath);
                        this.songCache.deleteMapInfoFromDirname(path.basename(mapPath));
                        progress.current++;
                    }

                    observer.next(progress);
                }
            })()
            .catch(e => observer.error(e))
            .finally(() => observer.complete());
        });
    }

    public async getMapInfoFromHash(hash: string, version?: BSVersion): Promise<BsmLocalMap> {
        const versionMapsPath = await this.getMapsFolderPath(version);
        const mapInfo = this.songCache.getMapInfoFromHash(hash);

        const cachedMapPath = (versionMapsPath && mapInfo?.dirname) && path.join(versionMapsPath, mapInfo.dirname);

        if(cachedMapPath && pathExistsSync(cachedMapPath)){
            return this.loadMapInfoFromPath(cachedMapPath);
        }

        // if not in cache, search in the folder
        const mapsPaths = await getFoldersInFolder(versionMapsPath);

        for (const mapPath of mapsPaths) {
            const { result: mapInfo } = await tryit(() => this.loadMapInfoFromPath(mapPath));
            if (mapInfo?.hash === hash) {
                return mapInfo;
            }
        }

        return null;
    }

    public importMaps(zipPaths: string[], version?: BSVersion): Observable<Progression<BsmLocalMap>> {
        return new Observable<Progression<BsmLocalMap>>(observer => {
            this.handleZipPaths(zipPaths, observer, version)
                .catch(error => observer.error(error))
                .finally(() => observer.complete());
        });
    }

    private async handleZipPaths(
        zipPaths: string[],
        observer: Subscriber<Progression<BsmLocalMap>>,
        version?: BSVersion
    ): Promise<void> {
        const info: {
            zips: ({
                path: string;
                // if the zip contains single or multiple maps
                single: boolean;
                // paths within the zip file where a map is located
                folders: string[];
            })[];
            total: number;
        } = {
            zips: [],
            total: 0,
        };

        for (const zipPath of zipPaths) {
            try {
                const zip = await JSZip.loadAsync(await readFile(zipPath));
                const files = zip.file(this.INFO_DAT_REGEX);
                if (files.length === 0) {
                    log.warn(`Zip file "${zipPath}" does not contain any "Info.dat" file`);
                    continue;
                }

                info.total += files.length;
                info.zips.push({
                    path: zipPath,
                    single: files.findIndex(file => file.name.includes(path.sep)) === -1,
                    folders: files.map(file => path.dirname(file.name)),
                });
            } catch (error: any) {
                log.warn(`Could not count maps ${zipPath}`, error);
            }
        }

        if (info.total === 0) {
            throw new CustomError("No \"Info.dat\" file located in any of the zip files", "invalid-zip");
        }

        // Setting up the progress bar
        const progress: Progression<BsmLocalMap> = {
            total: info.total,
            current: 0,
        };
        const mapsFolder = await this.getMapsFolderPath(version);

        observer.next(progress); // 0%

        for (const zipInfo of info.zips) {
            try {
                const content = await readFile(zipInfo.path);
                const zip = await JSZip.loadAsync(content);

                // Zip containing only a single map
                if (zipInfo.single) {
                    ++progress.current;

                    progress.data = await this.importMap(
                        zip, zipInfo.path, "",
                        path.basename(zipInfo.path, ".zip"),
                        mapsFolder
                    )
                    observer.next(progress);
                    continue;
                }

                // Zip containing multiple maps
                for (const relativeFolder of zipInfo.folders) {
                    ++progress.current;
                    try {
                        progress.data = await this.importMap(
                            zip, zipInfo.path,
                            relativeFolder,
                            path.basename(relativeFolder),
                            mapsFolder
                        );
                    } catch (error: any) {
                        log.error(`Could not import "${zipInfo.path}"`, error);
                        progress.data = undefined;
                    } finally {
                        observer.next(progress);
                    }
                }
            } catch (error: any) {
                log.error(`Could not import "${zipInfo.path}"`, error);
                progress.data = undefined;
                observer.next(progress);
            }
        }
    }

    private async importMap(
        zip: JSZip,
        zipPath: string, // where the zip file is located
        relativeFolder: string, // where is the map relative in the zip file
        mapName: string, // Map/Song name
        mapsFolder: string // Maps folder depending on the version
    ): Promise<BsmLocalMap> {
        let mapPath = "";
        let existing = false;
        try {
            mapPath = path.join(mapsFolder, mapName);
            existing = pathExistsSync(mapPath);
            log.info(`Importing map from "${zipPath}" in "${relativeFolder}" to "${mapPath}"`);

            if (!existing) {
                await mkdir(mapPath, { recursive: true });
            }

            // Prep the files
            let files: { [key: string]: JSZip.JSZipObject; } = {};
            if (relativeFolder === "") {
                // Zip containing only a single map
                files = zip.files;
            } else {
                // Zip containing multiple maps
                // async doesn't work here and zip.folder().files does not work as you expect
                zip.folder(relativeFolder).forEach((relativeFolder, file) => {
                    files[relativeFolder] = file;
                });
            }

            for (const [relativePath, file] of Object.entries(files)) {
                const filepath = path.join(mapPath, relativePath);
                if (file.dir) {
                    await ensureFolderExist(filepath);
                    continue;
                }

                log.info(`Extracting to "${filepath}"`);
                const content = await file.async("nodebuffer");
                await writeFile(filepath, content);
            }

            const localMap = await this.loadMapInfoFromPath(mapPath);
            localMap.songDetails = this.songDetailsCache.getSongDetails(localMap.hash);
            return localMap;
        } catch (error: any) {
            // If the mapPath isn't yet added, delete the map folder
            if (!existing && mapPath) {
                unlinkSync(mapPath);
            } else if (existing && mapPath) {
                log.warn(`Map folder ${mapPath} could be broken`);
            }

            throw error instanceof CustomError
                ? error
                : CustomError.fromError(error);
        }
    }

    public async downloadMap(map: BsvMapDetail, version?: BSVersion): Promise<BsmLocalMap> {
        if (!map.versions.at(0).hash) {
            throw new Error("Cannot download map, no hash found");
        }

        log.info("Downloading map", map.name, map.id);

        const zipUrl = map.versions.at(0).downloadURL;
        const mapFolderName = sanitize(`${map.id}-${map.name}`);
        const mapsFolder = await this.getMapsFolderPath(version);

        const mapPath = path.join(mapsFolder, mapFolderName);

        const installedMap = await pathExists(mapPath).then(exists => {
            if(!exists){ return null; }
            return this.loadMapInfoFromPath(mapPath);
        }).catch(() => null);

        if(map.versions.every(version => version.hash === installedMap?.hash)) {
            return installedMap;
        }

        const { zip, zipPath } = await this.downloadMapZip(zipUrl);

        if (!zip) {
            throw new Error(`Cannot download ${zipUrl}`);
        }

        await ensureFolderExist(mapPath);

        await zip.extract(null, mapPath);
        await zip.close();
        await unlink(zipPath);

        const localMap = await this.loadMapInfoFromPath(mapPath);
        localMap.songDetails = this.songDetailsCache.getSongDetails(localMap.hash);

        this._lastDownloadedMap.next({ map: localMap, version });

        return localMap;
    }

    public async exportMaps(version: BSVersion, maps: BsmLocalMap[], outPath: string): Promise<Observable<Progression>> {
        const archive = new Archive(outPath);

        if (!maps || maps.length === 0) {
            const mapsFolder = await this.getMapsFolderPath(version);
            archive.addDirectory(mapsFolder, false);
        } else {
            const mapsFolders = maps.map(map => map.path);
            mapsFolders.forEach(maps => archive.addDirectory(maps));
        }

        return archive.finalize();
    }

    public async oneClickDownloadMap(map: BsvMapDetail): Promise<void> {

        const versions = await this.localVersion.getInstalledVersions();
        const downloadedMap = await this.downloadMap(map, versions.pop());
        const downloadedMapRealFolder = await realpath(path.dirname(downloadedMap.path));

        for (const version of versions) {
            const versionMapsPath = await this.getMapsFolderPath(version);
            await ensureDir(versionMapsPath);

            if((await realpath(versionMapsPath)) === downloadedMapRealFolder){
                continue;
            }

            await copy(downloadedMap.path, path.join(versionMapsPath, path.basename(downloadedMap.path)), { overwrite: true });
        }
    }

    public enableDeepLinks(): boolean {
        return Array.from(Object.values(this.DEEP_LINKS)).every(link => this.deepLink.registerDeepLink(link));
    }

    public disableDeepLinks(): boolean {
        return Array.from(Object.values(this.DEEP_LINKS)).every(link => this.deepLink.unRegisterDeepLink(link));
    }

    public isDeepLinksEnabled(): boolean {
        return Array.from(Object.values(this.DEEP_LINKS)).every(link => this.deepLink.isDeepLinkRegistered(link));
    }

    public get lastDownloadedMap$(): Observable<{ map: BsmLocalMap, version?: BSVersion }> {
        return this._lastDownloadedMap.asObservable();
    }
}
