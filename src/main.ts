import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fsPromise from 'node:fs/promises';
import { csvReader, ICsvRecord } from './services/csvReader.js'
import { GoogleInteraction } from './services/GoogleInteraction.js'
import { FileDownloaderAndConverter } from './services/FileDownloaderAndConverter.js'
import dotenv from 'dotenv';
import { DatabaseService, IColumnDefinition } from './services/DatabaseService.js';
import { GeminiApi } from './services/GeminiSDK.js'


const nodeEnv = process.env.NODE_ENV;
const envFileName = nodeEnv === 'development' ? '.env.development' : '.env';
const envFilePath = path.resolve(process.cwd(), envFileName);
dotenv.config({ path: envFilePath });

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);


const tempDir: string = path.join(process.cwd(), 'temp_downloads');
const original_download: string = path.join(tempDir, 'original_download');
const toBeUploaded: string = path.join(tempDir, 'to_be_uploaded');
const toBeCombined: string = path.join(tempDir, 'to_be_combined');
const alreadyUploaded: string = path.join(toBeUploaded, 'already_uploaded');
const alreadyCombined: string = path.join(toBeCombined, 'already_combined');
const dbPath: string = path.resolve(process.cwd(), 'sql', 'database_core.db');

const googleDriveDestinationFolderId = process.env.GOOGLE_DRIVE_DESTINATION_FOLDER_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;

const checkFolder = [tempDir, original_download, toBeCombined, toBeUploaded, alreadyUploaded, alreadyCombined];
const checkEnv = [googleDriveDestinationFolderId, geminiApiKey];

for (const env of checkEnv) {
    if (!env) {
        console.log(`[MAIN] ENV Data is missing`)
        throw new Error(`[MAIN] ENV Data is missing`);
    }
}

const createDirectories = async () => {
    await Promise.all(checkFolder.map(folder => fsPromise.mkdir(folder, { recursive: true })));
};

createDirectories().catch(err => {
    console.error(`[MAIN] Error while creating base folder: ${err}`);
    throw err;
})


let sqlite: DatabaseService;

const tableInformation: IColumnDefinition[] = [
    { name: 'fileName', type: 'TEXT PRIMARY KEY' },
    { name: 'submissionTime', type: 'TEXT NOT NULL' },
    { name: 'condoName', type: 'TEXT' },
    { name: 'roomNumber', type: 'TEXT NOT NULL' },
    { name: 'fileLink', type: 'TEXT NOT NULL' },
    { name: 'transferFromWhom', type: 'TEXT' },
    { name: 'transferToWhom', type: 'TEXT' },
    { name: 'transferFromAccountNo', type: 'TEXT' },
    { name: 'transferToAccountNo', type: 'TEXT' },
    { name: 'transferDateTime', type: 'TEXT' },
    { name: 'amount', type: 'INTEGER' },
    { name: 'transactionID', type: 'TEXT' },
    { name: 'transactionSlipMemo', type: 'TEXT' },
];

const tableName: string = 'payment_records'

async function main() {
    try {
        if (!(googleDriveDestinationFolderId && geminiApiKey)) {
            throw new Error("[MAIN] Failed reading env");
        }
        const geminiInterface = new GeminiApi(geminiApiKey);
        sqlite = await new DatabaseService(dbPath);
        await sqlite.connect();
        // const result = await sqlite.getAllTableData('tableName');
        // console.log(result);

        await sqlite.ensureTableExists(tableName, tableInformation);
        const fileProcess = new FileDownloaderAndConverter(sqlite, geminiInterface, tableName);
        // const pdfInfo = await fileProcess.countPdfPages(path.resolve(original_download, '89- 556 A.pdf'));
        // await fileProcess.convertPdfToJpg(pdfInfo.absolutePath, pdfInfo.pageCount, 1);

        const googleInterface = await GoogleInteraction.create(fileProcess);
        const parser = new csvReader();
        const csvData: ICsvRecord[] = await parser.parseCSV();
        // console.log(csvData);

        // // const filteredCsvData = await sqlite.filterOutRowsAlreadyInDatabase(csvData, tableName, 'fileName');
        const CsvFormatted = fileProcess.csvToUploadPath(csvData);
        await fileProcess.downloadAndConvertFile(CsvFormatted);
        await googleInterface.uploadFilesToDrive(toBeUploaded, googleDriveDestinationFolderId);

    } catch (err) {
        console.error("[MAIN] Error in main function: ", err);
        throw err;
    } finally {
        // if (sqlite && sqlite.isConnected()) {
        //     console.log("[MAIN] Disconnecting Database");
        //     await sqlite.disconnected();
        // } else {
        //     console.error("[MAIN] Database disconnection error");
        // }
    }
}

main();