import { google, drive_v3 } from 'googleapis';
import * as mime from 'mime-types';
import { FileDownloaderAndConverter } from './FileDownloaderAndConverter.js'
import * as path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

const targetEnv = process.env.NODE_ENV;
const envFileName = targetEnv ? `.env.${targetEnv}` : '.env';
const envFilepath = path.join(process.cwd(), envFileName);
dotenv.config({path:envFilepath});

const tempDir: string = path.join(process.cwd(), 'temp_downloads');
const toBeUploaded: string = path.join(tempDir, 'to_be_uploaded');
const toBeCombined: string = path.join(tempDir, 'to_be_combined');
const alreadyUploaded: string = path.join(toBeUploaded, 'already_uploaded');
const googleServiceFile: string = path.join(process.cwd(), 'service-account.json');


class GoogleInteraction {

    private readonly fileDownloadInstance: FileDownloaderAndConverter;
    private driveService?: drive_v3.Drive;

    constructor(classRef: FileDownloaderAndConverter) {
        this.fileDownloadInstance = classRef;
    }

    private async initialize(): Promise<void> {
        try {
            const auth = new google.auth.JWT({
                keyFile: googleServiceFile,
                scopes: ['https://www.googleapis.com/auth/drive']
            });

            this.driveService = google.drive({ version: 'v3', auth: auth });
            console.log("[GoogleInteraction] Google Authentication Successful")
        } catch (err) {
            console.error("[GoogleInteraction] Error while authenticating Google: ", err);
            throw err;
        }
    }

    static async create(ref: FileDownloaderAndConverter): Promise<GoogleInteraction> {
        const uploader = new GoogleInteraction(ref);
        await uploader.initialize();
        return uploader;
    }

    public async uploadFilesToDrive(inputFolder: string, driveFolderID: string): Promise<void> {

        if (!this.driveService) {
            throw new Error("[GoogleInteraction] Drive service is not initialized.");
        }

        try {

            const filesList: string[] = await FileDownloaderAndConverter.getFilesInFolder(inputFolder)

            console.log(`[GoogleInteraction] Uploading: ${filesList}
                Total: ${filesList.length} files`)

            for (const filePath of filesList) {

                console.log(`[GoogleInteraction] Uploading: ${filePath}`)

                const pathToMoveFileTo = path.join(alreadyUploaded, path.parse(filePath).base)
                const fileNameWithExtension: string = path.parse(filePath).base;

                const calculatedMimeType: string = mime.lookup(filePath) || 'application/octet-stream';

                const fileMetadata = {
                    name: fileNameWithExtension,
                    parents: [driveFolderID]
                }

                const media = {
                    mimeType: calculatedMimeType,
                    body: fs.createReadStream(filePath)
                }
                    
                try {
                    const uploadedFile = await this.driveService.files.create({
                        requestBody: fileMetadata,
                        media,
                        fields: 'id, name, webViewLink',
                    });
                    console.log(`[GoogleInteraction] Upload File Name [${uploadedFile.data.name}] Successfully`)

                    await fs.promises.rename(filePath, pathToMoveFileTo);
                    console.log(`[GoogleInteraction] file moved: ${filePath}`)
                    
                } catch (err) {
                    console.error (`[GoogleInteraction] Error while uploading ${fileNameWithExtension}: ${err}`);
                    throw err
                }
                
                
            }
        
        } catch (err) {
            console.error (`[GoogleInteraction] "Error while uploading to Drive: ${err}`);
            throw err
        }
    }
}

export {GoogleInteraction}