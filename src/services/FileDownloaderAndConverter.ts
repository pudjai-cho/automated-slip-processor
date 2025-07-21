import fs from 'node:fs';
import * as fsPromise from 'node:fs/promises';
import * as path from 'node:path';
import stream from 'node:stream';
import { promisify } from 'node:util';

import fetch from 'node-fetch';
import spawn from 'cross-spawn';
import sharp from 'sharp';
import dotenv from 'dotenv';

import { DatabaseService } from './DatabaseService.js';
import { GeminiApi } from './GeminiSDK.js'
import { ICsvRecord } from './csvReader.js'

const targetEnv = process.env.NODE_ENV;
const envFileName = targetEnv ? `.env.${targetEnv}` : '.env';
const envFilepath = path.join(process.cwd(), envFileName);
dotenv.config({path:envFilepath});

const TEMP_DIR: string = path.join(process.cwd(), 'temp_downloads');
const ORIGINAL_DOWNLOAD: string = path.join(TEMP_DIR, 'ORIGINAL_DOWNLOAD');
const TO_BE_UPLOADED: string = path.join(TEMP_DIR, 'to_be_uploaded');
const TO_BE_COMBINED: string = path.join(TEMP_DIR, 'to_be_combined');
const ALREADY_COMBINED: string = path.join(TO_BE_COMBINED, 'already_combined');




interface INonJpgFileInfo {
    nameWithExtension: string;
    nameNoExtension: string;
    // filePath: string;
}


interface IPdfPageInfo {
    pageCount: number;
    absolutePath: string;
}

interface IFormattedCsv {
    fileName: string;
    fileLink: string[];
    numberOfFiles: number;
    submissionTime: string;
    condoName: string;
    roomNumber: string;
    monthsCovered?: string;
    transferFromWhom: string | null;
    transferToWhom: string | null;
    transferFromAccountNo: string | null;
    transferToAccountNo: string | null
    transferDateTime: string | null;
    amount: number | null;
    transactionID: string | null;
    transferReceiptMemo: string | null;
}

interface ICombineImageInfo {
    path: string;
    width: number;
    height: number;
}

class FileDownloaderAndConverter {

    private readonly sqliteInstance: DatabaseService;
    private readonly geminiInterface: GeminiApi;
    private readonly sqlTableName: string

    constructor(classRef: DatabaseService, geminiInterface: GeminiApi, SqlTableName: string) {
        this.sqliteInstance = classRef;
        this.geminiInterface = geminiInterface;
        this.sqlTableName = SqlTableName;
    }

    public async getFileDetailsFromPath(sourceFilePath: string): Promise<INonJpgFileInfo> {
        try {
            const parsedPath = path.parse(sourceFilePath);

            const sourceFileNameWithExtension = parsedPath.base;
            const sourceFileNameWithoutExtension = parsedPath.name;

            // const newFileFolderPath = path.join(ORIGINAL_DOWNLOAD, sourceFileNameWithExtension);
            // await fs.promises.rename(sourceFilePath, newFileFolderPath);


            return {
                nameWithExtension: sourceFileNameWithExtension,
                nameNoExtension: sourceFileNameWithoutExtension,
                // filePath: newFileFolderPath
            }
        } catch (err) {
            console.error(`[FileDownloaderAndConverter] Error while moving non jpg file ${sourceFilePath}: ${err}`);
            throw err;
        }
    }

    private async convertNonJpgToJpg(sourceFilePath: string, totalImages: number): Promise<string[]> {
        try {

            let finalFilePath = [];
            const NonJpgFileInfo = await this.getFileDetailsFromPath(sourceFilePath);
            let outputImagePath;
            if (totalImages > 1) {
                outputImagePath = path.join(TO_BE_COMBINED, `${NonJpgFileInfo.nameNoExtension}.jpg`);
            } else {
                outputImagePath = path.join(TO_BE_UPLOADED, `${NonJpgFileInfo.nameNoExtension}.jpg`);
            }

            await sharp(sourceFilePath)
                .jpeg()
                .toFile(outputImagePath);

            finalFilePath.push(outputImagePath);

            return finalFilePath;
        } catch (err) {
            console.error(`[FileDownloaderAndConverter] Error while converting Image To Jpg ${sourceFilePath}: ${err}`);
            throw err;
        }
    }

    public async countPdfPages(sourceFilePath: string): Promise<IPdfPageInfo> {
        return new Promise ((resolve, reject) => {

            const absolutePath = path.resolve(sourceFilePath);

            const args = [
                'identify',
                '-format',
                '%n',
                absolutePath
            ];

            const gmProcess = spawn('gm', args);

            let stdoutData = '';
            let stderrData = '';

            gmProcess.stdout?.on('data', (data) => {
                stdoutData += data.toString();
            });

            gmProcess.stderr?.on('data', (data) => {
                stderrData += data.toString();
            });

            gmProcess.on('error', (error) => {
                let errorMessage = `[FileDownloaderAndConverter] Failed to start GraphicMagick: ${error.message}`;
                if (error.message.includes('ENOENT')) {
                    errorMessage += `\n\nHint: Ensure GraphicMagick (em) is installed and accessible in your system's PATH.`
                }
                return reject(new Error(errorMessage));
            });

            gmProcess.on('close', (code) => {
                if (code !== 0) {
                    let errorMessage = `[FileDownloaderAndConverter] GraphicsMagick process exited with code ${code}.`;
                    if (stderrData) {
                        errorMessage += `\nStderr: ${stderrData.trim()}`;
                    }
                    if (stderrData && stderrData.includes('NoDecodeDelegateForThisImageFormat')) {
                        errorMessage += `\n\nHint: The file might not be a valid PDF or GraphicsMagick lacks the necessary delegate (like Ghostscript) to read it.`;
                    } else if (stderrData === '' && code === 1 && stdoutData === '') {
                        // Sometimes GM fails silently on invalid files with exit code 1
                        errorMessage += `\n\nHint: The input file (${absolutePath}) might be invalid or corrupted.`;
                    }

                    return reject(new Error(errorMessage));
                    }

                const outputLines = stdoutData.trim().split('\n');
                const firstLine = outputLines[0];

                if (!firstLine) {
                    return reject (
                        new Error(`[FileDownloaderAndConverter] GraphicsMagick command succeeded but produced empty output for ${absolutePath}. Stderr: ${stderrData.trim()}`)
                    );
                }

                let currentPage = '';
                let pageCount;
                for (const char of firstLine) {
                    currentPage += char;
                    let answer = currentPage.repeat(parseInt(currentPage));
                    console.log(`[FileDownloaderAndConverter] currentPage : ${currentPage}, char: ${char}`);
                    if (answer === firstLine) {
                        pageCount = parseInt(currentPage, 10);
                        break;
                    }
                }

                if (!pageCount) {
                    return reject(
                        new Error(`[FileDownloaderAndConverter] Failed to parse page count from GraphicsMagick output: "${stdoutData.trim()}". Stderr: ${stderrData.trim()}`)
                    );
                }

                resolve({
                    pageCount,
                    absolutePath,
                });
            })
        })
    }


    public async convertPdfToJpg(sourceFilePath: string, pdfPages: number, numberOfFilesInTheRow: number): Promise<Array<string>> {
        try {
            // const gmPath = "C:\\Program Files\\GraphicsMagick-1.3.42-Q8\\gm.exe"
            const density = 300;

            const NonJpgFileInfo = await this.getFileDetailsFromPath(sourceFilePath);

            const generatedFilePaths: string[] = [];


            for (let i = 0; i < pdfPages; i++) {
                const pageIndex = i;
                const pageNumber = i + 1;

                let outputFilePath: string;

                if (pdfPages > 1 || numberOfFilesInTheRow > 1) {
                    outputFilePath = path.join(TO_BE_COMBINED, `${NonJpgFileInfo.nameNoExtension}%d${pageIndex}.jpg`);
                } else {
                    outputFilePath = path.join(TO_BE_UPLOADED, `${NonJpgFileInfo.nameNoExtension}.jpg`);
                }

                console.log(`[FileDownloaderAndConverter] [Page ${pageNumber}/${pdfPages}] Converting: ${sourceFilePath}[${pageIndex}] -> ${outputFilePath}`);

                const args = [
                    'convert',
                    '-density', String(density),
                    `${sourceFilePath}[${pageIndex}]`,
                    outputFilePath
                ];
                const newFilePath = await new Promise<string>((resolve, reject) => {
                    const gmProcess = spawn('gm', args);
                    let stderrOutput = '';

                    gmProcess.stderr?.on('data', (data) => {
                        stderrOutput += data.toString();
                        // console.error(`GM stderr (page ${pageNumber}): ${data.toString()}`);
                    });

                    gmProcess.on('close', (code, signal) => {
                        if (code===0) {
                            console.log(`[FileDownloaderAndConverter] GraphicsMagick completed successfully [Page: ${pageNumber}] -> ${outputFilePath}`)
                            resolve(outputFilePath);
                    }   else {
                        console.error(`[FileDownloaderAndConverter] GM stderr (page ${pageNumber}): ${stderrOutput}`);
                        reject(new Error(`[FileDownloaderAndConverter] GraphicsMagick failed for page ${pageNumber} with code ${code}, signal ${signal}.\nInput: ${sourceFilePath}[${pageIndex}]\nOutput: ${outputFilePath}\nStderr: ${stderrOutput}`));
                    }
                    });

                    gmProcess.on('error', (err) => {
                        reject(new Error(`[FileDownloaderAndConverter] GraphicsMagick spawn error for page ${pageNumber}: ${err.message}\nInput: ${sourceFilePath}[${pageIndex}]\nOutput: ${outputFilePath}`));
                    });
                });

                generatedFilePaths.push(newFilePath);

            }

            if (pdfPages > 1) {

                console.log(`[FileDownloaderAndConverter] All ${pdfPages} pages converted individually. Combining...`);

                await this.combineImage(NonJpgFileInfo.nameNoExtension)
            } else {
                // Single page PDF was created directly in 'TO_BE_UPLOADED'.
                // generatedFilePaths should contain exactly one path.
                if (generatedFilePaths.length !== 1) {
                     // This shouldn't happen if pdfPages was 1 and loop ran once without error
                    console.error("[FileDownloaderAndConverter] Expected 1 file path for single page PDF, but found:", generatedFilePaths);
                    throw new Error("Internal error during single page PDF conversion.");
                }
                // Return the path to the single generated file in an array

            }

            return generatedFilePaths


        } catch (err) {
            console.error(`[FileDownloaderAndConverter] Error while converting PDF to JPG: ${err}`);
            throw err;
        }
    }

    private getFileExtension(fileURL: string): string | undefined {
        try {
            const urlObj = new URL(fileURL);
            const pathname = urlObj.pathname;
            const lastDotIndex = pathname.lastIndexOf('.');
            if (lastDotIndex === -1 || lastDotIndex === pathname.length - 1) {
                return undefined;
            }
            return pathname.substring(lastDotIndex + 1).toLowerCase();
        } catch (err) {
            console.error("[FileDownloaderAndConverter] Error while getting file extension: ", err);
            return undefined;
        }
    }

    static async getFilesInFolder(folderPath: string): Promise<string[]> {
        try {
            const filesInFolderPaths = [];
            const entries = await fsPromise.readdir(folderPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isFile()) {
                    const fullPath = path.join(folderPath, entry.name);
                    filesInFolderPaths.push(fullPath);
                }
            }
            return filesInFolderPaths;
        } catch (err) {
            console.error(`[FileDownloaderAndConverter] Error while reading directory ${folderPath}: ${err}`);
            throw err;
        }

    }

    private async combineImage(inputFileName: string, inputFolderPaths: string = TO_BE_COMBINED): Promise<void> {

        const fileLists = await FileDownloaderAndConverter.getFilesInFolder(inputFolderPaths);
        const outputFilePath = path.join(TO_BE_UPLOADED, `${inputFileName}.jpg`)

        if (!fileLists || fileLists.length < 2) {
            throw new Error ("[FileDownloaderAndConverter] Please provide at least two image paths.");
        }

        try {
            console.log('[FileDownloaderAndConverter] Reading image metadata');

            const imageInfoPromises = fileLists.map(async (imgPath): Promise<ICombineImageInfo> => {
                const metaData = await sharp(imgPath).metadata();
                if (!metaData.width || !metaData.height) {
                    throw new Error (`[FileDownloaderAndConverter] Error while reading ${imgPath}`)
                }
                return {
                    path: imgPath,
                    width: metaData.width,
                    height: metaData.height
                };

            });

            const imageInfo = await Promise.all(imageInfoPromises);

            let maxHeight = 0;
            let totalWidth = 0;

            imageInfo.forEach( info => {
                if (info.height && info.height > maxHeight) {
                    maxHeight = info.height;
                }

                totalWidth += info.width;
            });

            if (maxHeight === 0 || totalWidth === 0) {
                throw new Error ('[FileDownloaderAndConverter] Max width and Max height are all 0')
            }
            console.log('[FileDownloaderAndConverter] centering images');

            const compositeOptions: sharp.OverlayOptions[] = [];
            let currentLeftOffset = 0;

            imageInfo.forEach((info) => {

                const topOffset = Math.round((maxHeight - info.height) / 2);

                compositeOptions.push({
                    input: info.path,
                    top: topOffset,
                    left: currentLeftOffset
                });

                currentLeftOffset += info.width;
            })

            console.log('[FileDownloaderAndConverter] combining Image')

            const background: sharp.Color = { r: 255, g: 255, b: 255, alpha: 1}

            const finalImage = sharp({
                create: {
                    width: totalWidth,
                    height: maxHeight,
                    channels: 4,
                    background: background
                }
            });

            await finalImage
                .composite(compositeOptions)
                .toFile(outputFilePath);

            console.log(`[FileDownloaderAndConverter] Successfully combined ${fileLists.length} images into ${outputFilePath}`);

            let newFilerPath;

            for (const file of fileLists) {
                const fileName = path.parse(file).base;
                newFilerPath = path.join(ALREADY_COMBINED, fileName);
                await fs.promises.rename(file, newFilerPath);
            }

            console.log(`[FileDownloaderAndConverter] All original files (pre-combined files) moved successfully ${newFilerPath}`);

        } catch (err) {
            console.error(`[FileDownloaderAndConverter] Error while combining file: ${inputFileName}`)
            throw err
        }
    }

    // private async insertDataToSqlRow(tableName: string, inputObject: IFormattedCsv): Promise<void> {




    // }


    public async downloadAndConvertFile(inputObject: IFormattedCsv[]): Promise<void> {

        try {
            const pipeline = promisify(stream.pipeline);
            let currentRow = 0
            for (const row of inputObject) {
                const { fileName, fileLink, numberOfFiles } = row;
                currentRow += 1;
                let iteration = 0;
                let mustConvert;
                console.log(`[FileDownloaderAndConverter] Current Row: ${currentRow}`);
                console.log("[FileDownloaderAndConverter]", row);
                let imagePathBeforeCombined:string[] = [];

                for (const file of fileLink) {

                    mustConvert = null;

                    iteration += 1;
                    console.log(`[FileDownloaderAndConverter] Current File: ${iteration}`);
                    let currentFileName;

                    if (numberOfFiles > 1) {
                        currentFileName = `${fileName}%${iteration}`
                    } else {
                        currentFileName = fileName
                    }


                    const fetchResponse = await fetch(file);
                    if (!fetchResponse.ok) {
                        throw new Error(`[FileDownloaderAndConverter] Failed to fetch file: ${fetchResponse.status} ${fetchResponse.statusText}`);

                    }
                    if (!fetchResponse.body) {
                        throw new Error(`[FileDownloaderAndConverter] fetchResponse body is null, no body to download`)
                    }

                    const sourceFileExtension = this.getFileExtension(file);

                    // const contentType = fetchResponse.headers.get('content-type');
                    // let sourceFileExtension = ''
                    // if (contentType) {
                    //     sourceFileExtension = mime.extension(contentType) || '';
                    // }

                    const allowedExtensions = ['jpg', 'jpeg'];
                    // const sourceFileExtension = 'pdf'

                    if (!sourceFileExtension) {
                        throw new Error(`[FileDownloaderAndConverter] Can't find file extension`)
                    }

                    const desiredFileNameWithExtension = `${currentFileName}.${sourceFileExtension}`
                    let downloadFilePath;


                    if (!allowedExtensions.includes(sourceFileExtension)) {
                        downloadFilePath = path.join(ORIGINAL_DOWNLOAD, desiredFileNameWithExtension);
                        mustConvert = true;

                    } else if (allowedExtensions.includes(sourceFileExtension) && numberOfFiles > 1) {
                        downloadFilePath = path.join(TO_BE_COMBINED, desiredFileNameWithExtension);
                        imagePathBeforeCombined.push(downloadFilePath);
                    }

                    else {
                        downloadFilePath = path.join(TO_BE_UPLOADED, desiredFileNameWithExtension);
                        imagePathBeforeCombined.push(downloadFilePath);
                    }

                    await pipeline(fetchResponse.body, fs.createWriteStream(downloadFilePath));
                    console.log(`[FileDownloaderAndConverter] File Download to: ${downloadFilePath}`);

                    const supportedExtensions: string[] = [
                        'png',
                        'webp',
                        'gif',
                        'avif',
                        'tif',
                        'tiff',
                        'svg',
                        ];

                    if (mustConvert) {
                        if (sourceFileExtension === 'pdf') {
                            const pdfPages = await this.countPdfPages(downloadFilePath)
                            imagePathBeforeCombined = await this.convertPdfToJpg(pdfPages.absolutePath, pdfPages.pageCount, numberOfFiles);
                        } else if (supportedExtensions.includes(sourceFileExtension)){
                            imagePathBeforeCombined = await this.convertNonJpgToJpg(downloadFilePath, numberOfFiles);
                        } else {
                            throw new Error(`[FileDownloaderAndConverter] File Extension is not supported: ${sourceFileExtension}`);
                        }
                    }

                    // for (const path of imagePathBeforeCombined) {
                    //     const imageJsonData = this.geminiInterface.geminiOCR(path);
                    //     const tableColumns: string[] = [
                    //         "transferFromWhom",
                    //         "transferToWhom",
                    //         "transferFromAccountNo",
                    //         "transferToAccountNo",
                    //         "transferDateTime",
                    //         "amount",
                    //         "transactionID",
                    //         "transferReceiptMemo"
                    //     ];
                    //     if (imagePathBeforeCombined.length > 1) {
                            
                    //         for (const column of tableColumns) {
                    //             inputObject[column] = [];
                    //         }
                    //     }
                    // }

                }

                console.log('imagePathBeforeCombined\n',imagePathBeforeCombined);

                // await this.insertSqlRow(this.sqlTableName, row);


                if (numberOfFiles > 1){
                    await this.combineImage(fileName);
                }

                
            }
        } catch (err) {
            console.error("[FileDownloaderAndConverter] Error while looping to download and process files: ", err);
            throw err;
        }
    }

    public csvToUploadPath(inputCsv: ICsvRecord[]): IFormattedCsv[] {
        try {
            const pattern = /[/\\:;*?"<>| \x00-\x1F]/g
            const result: IFormattedCsv[] = [];
            for (const room of inputCsv) {

                const valuesToCheck = [
                    room.roomNumber,
                    room.submissionTime,
                    room.monthsCovered,
                    room.fileLink,
                    room.fileName,
                ];
                const isInComplete = valuesToCheck.some((value) => !value);
                if (isInComplete) {
                    throw new Error (`[FileDownloaderAndConverter] Data from this row is incomplete: ${room}`)
                }
                
                if (typeof(room["fileLink"]) !== 'object') {
                    throw new Error(`[FileDownloaderAndConverter] room["fileLink"] must be an array of strings: ${room["fileLink"]}`)
                }

                const formattedCsv: IFormattedCsv = {
                    fileName: room.fileName,
                    fileLink: room.fileLink,
                    numberOfFiles: room.fileLink.length,
                    submissionTime: room.submissionTime,
                    condoName: room.condoName,
                    roomNumber: room.roomNumber,
                    transferFromWhom: null,
                    transferToWhom: null,
                    transferFromAccountNo: null,
                    transferToAccountNo: null,
                    transferDateTime: null,
                    amount: null,
                    transactionID: null,
                    transferReceiptMemo: null
                };

                result.push(formattedCsv);
            }
            console.log("[FileDownloaderAndConverter] csvToUploadPath successful");
            // console.log(result);
            return result;
        } catch (err) {
            console.error(`[FileDownloaderAndConverter] Error while formatting CSV File: ${err}`);
            throw err;
        }
    }
}


export { FileDownloaderAndConverter }