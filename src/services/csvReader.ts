import * as path from 'node:path';
import fs from 'node:fs';
import { parse, Options } from 'csv-parse';
import { finished } from 'node:stream/promises';

const csvFilePath: string = path.resolve(process.cwd(), 'data', 'PaymentSlips.csv');

interface ICsvRecord {
    'fileName': string;
    'submissionTime': string;
    'condoName': string;
    'roomNumber': string;
    'monthsCovered': string;
    'fileLink': string | string[];
}

class csvReader {


    public async parseCSV(): Promise<ICsvRecord[]> {

        try {
            const customHeaders = [
                'submissionTime',
                'condoName',
                'roomNumber',
                'monthsCovered',
                'fileLink'
            ];

            const records: ICsvRecord[] = [];

            const parserOptions: Options = {
                delimiter: ',',
                columns: customHeaders,
                from_line: 2,
                trim: true,
                skip_empty_lines: true,
                cast: false,
            }
            const parser = fs.createReadStream(csvFilePath)
                .pipe(parse(parserOptions));

            parser.on('readable', () => {
                let record: ICsvRecord | null;
                while ((record = parser.read() as ICsvRecord | null) != null) {
                    records.push(record);
                }
            });

            await finished(parser);

            console.log("[csvReader] parseCSV Successful")

            try {
                const pattern = /[/\\:;*?"<>| \x00-\x1F]/g
                for (const rec of records) {
                    if (typeof rec.fileLink === 'string') {
                        const formattedFilelink = rec.fileLink.split(";").map((data) => data.trim()).filter((data) => data.length > 0);
                        rec.fileLink = formattedFilelink;
                    }
                    const formattedRoomNumber = rec.roomNumber.replace(pattern, "-");
                    const formattedDateTime = rec.submissionTime.split('.')[0].replace(/[:-]/g, "_");
                    const formattedFileName = `${formattedRoomNumber}, ${formattedDateTime}`;
                    rec.fileName = formattedFileName;
                }
            } catch (err) {
                console.error(`[csvReader] Error while formatting file name: ${err} `)
                throw err;
            }


            return records;

        } catch (err) {
            console.error(`[csvReader] Error while parsing CSV: ${err}`);
            throw err;
        }
    }
}

export { csvReader, ICsvRecord };