import { Database } from 'sqlite3';
import { SqliteAsyncWrapper } from './SqliteAsyncWrapper.js';

interface IColumnDefinition {
    name: string;
    type: string;
}

interface IColumnInfo {
    cid: number
    name: string
    type: string
    notnull: number
    dflt_value: any
    pk: number
}

class DatabaseService {
    private db: Database | null = null;
    private readonly dbFilePath: string;


    constructor(dbFilePath: string) {
        if (!dbFilePath) {
            throw new Error('[DatabaseService] Database file path cannot be empty');
        }
        this.dbFilePath = dbFilePath;
        console.log(`Database is connected to: ${dbFilePath}`)
    }

    public isConnected(): boolean {
        return this.db !== null;
    }

    private ensureConnected(): void {
        if (!this.db) {
            throw new Error('[DatabaseService] Database is not connected');
        }
    }

    public async connect(): Promise<void> {
        if (this.db) {
            console.log('[DatabaseService] Database already connected');
            return;
        }
        try {
            this.db = await SqliteAsyncWrapper.open(this.dbFilePath);
            console.log(`[DatabaseService] connected to: ${this.dbFilePath}`);
        } catch (err) {
            this.db = null;
            console.error(`[DatabaseService] failed to connect to: ${this.dbFilePath}: ${err}`);
            throw err;
        }
    }

    public async disconnected(): Promise<void> {
        if (!this.db) {
            console.log('[DatabaseService] Database not connected');
            return;
        }

        const dbToClose = this.db;
        this.db = null;
        try {
            await SqliteAsyncWrapper.close(dbToClose);
            console.log(`[DatabaseService] disconnected from ${this.dbFilePath}`);
        } catch (err) {
            console.error(`[DatabaseService] error during disconnet from ${this.dbFilePath}`);
            throw err;
        }
    }
    public async ensureTableExists(tablename: string, columns: IColumnDefinition[]): Promise<void> {
        this.ensureConnected();
        const columnDefs = columns
            .map(col => `${col.name} ${col.type}`)
            .join(', ');
        const createTableSQL = `CREATE TABLE IF NOT EXISTS ${tablename} (${columnDefs})`;
        console.log(`[DatabaseService] Ensuring table ${tablename} exists`);

        await SqliteAsyncWrapper.run(this.db!, createTableSQL);
        console.log(`[DatabaseService] Table ${tablename} is ready`);
    }

    public async run(sql: string, params: any[] = []): Promise<{lastID: number; changes: number}> {
        this.ensureConnected();
        return SqliteAsyncWrapper.run(this.db!, sql, params);
    }

    public async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
        this.ensureConnected();
        return SqliteAsyncWrapper.get<T>(this.db!, sql, params);
    }

    public async all<T>(sql: string, params: any[] = []): Promise<T[]> {
        this.ensureConnected();
        return SqliteAsyncWrapper.all<T>(this.db!, sql, params);
    }

    public async getTableColumns(tableName: string): Promise<IColumnInfo[]> {
        this.ensureConnected();
        const sql = `PRAGMA table_info(${tableName})`;
        try {
            const tableColumns = await SqliteAsyncWrapper.all<IColumnInfo>(this.db!, sql);
            return tableColumns;
        } catch (err) {
            console.error(`[DatabaseService] Error while getting table info: ${err}`);
            throw err;
        }
    }

    public async recordExists(tableName: string, columnName: string, data: string): Promise<Record<string, any> | undefined> {
        this.ensureConnected();

        if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)){
            throw new Error(`[DatabaseService] Table name doesn't matched the allowed format, tableName: ${tableName}`);
        }
        const sql = `SELECT * FROM ${tableName} WHERE ${columnName} = ? LIMIT 1`;
        try {
            const matchResult = await SqliteAsyncWrapper.get<Record<string, any> | undefined>(this.db!, sql, [data]);
            return matchResult;
        } catch (err) {
            console.error(`[DatabaseService] Error while checking if recordExists: ${err} `);
            throw err;
        }
    }

    public async filterOutRowsAlreadyInDatabase<T extends Record<string, any>>(arrayOfObjects: T[], tableName: string, columnName: string): Promise<T[]> {

        try {

            // const isTableNameValid = tableName && /^[a-zA-Z0-9_]+$/.test(tableName);
            // const isColumnNameValid = columnName && /^[a-zA-Z0-9_]+$/.test(columnName);

            this.ensureConnected();

            const allowedTable = ['payment_records']
            const allowedColumn = ['fileName']

            // if (!(isTableNameValid && isColumnNameValid)) {
            //     throw new Error (`[DatabaseService] Table name of Column name doesn't matched the allowed format: tableName: ${tableName}, columnName: ${columnName}`);
            // }

            if (!(allowedTable.includes(tableName) && allowedColumn.includes(columnName))) {
                throw new Error (`[DatabaseService] Table name of Column name doesn't matched the allowed list: tableName: ${tableName}, columnName: ${columnName}`);
            }

            const notInTableResult: T[] = [];
            let addedCount = 0;
            let skippedCount = 0;
            const indexSql = `CREATE INDEX IF NOT EXISTS idx_${tableName}_${columnName} ON ${tableName} (${columnName})`
            await this.run(indexSql);

            for (const row of arrayOfObjects) {

                if (!(columnName in row)) {
                    console.warn(`[DatabaseService] Skipping row because column '${columnName}' is missing:`, row);
                    continue;
                }

                const data = row[columnName];

                if (data === null || data === undefined) {
                    console.warn(`[DatabaseService] Skipping row because data for column '${columnName}' is null/undefined:`, row);
                    continue;
                }
                const result = await this.recordExists(tableName, columnName, String(data));
                if (!result) {
                    notInTableResult.push(row);
                    addedCount++;
                    console.log(`[DatabaseService] This data is not in the table: ${data}`)
                } else {
                    skippedCount++;
                    console.log(`[DatabaseService] This row is already in the database Row:`);
                    console.log(row); // No prefix needed for the data itself
                    console.log('[DatabaseService] Data in table:')
                    console.log(result); // No prefix needed for the data itself
                }
            }
            return notInTableResult;
        } catch (err){
            console.error(`[DatabaseService] Error while filtering rows: ${err}`);
            throw err
        }
    }

    public async deleteAllRowsFromTable(tableName: string): Promise<{lastID: number; changes: number}> {
        try {
            this.ensureConnected();
            if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)){
                throw new Error(`[DatabaseService] Table name doesn't matched the allowed format, tableName: ${tableName}`);
            }
            const sql = `DELETE FROM ${tableName}`;
            const result = await this.run(sql);
            console.log(`[DatabaseService] Content in Table: ${tableName} has been erased`)
            return result;
        } catch (err) {
            console.error(`[DatabaseService] Error while deleting all rows from the table: ${tableName}: ${err}`);
            throw err;
        }
    }

    public async dropTable(tableName: string): Promise<void> {
        try {
            this.ensureConnected();
            if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
                throw new Error (`[DatabaseService] Table name doesn't matched the allowed format, tableName: ${tableName}`);
            }
            const sql = `DROP TABLE ${tableName}`
            await this.run(sql);
            console.log(`[DatabaseService] Table ${tableName} has been dropped`)
        } catch (err) {
            console.error(`[DatabaseService] Error while dropping table ${tableName}: ${err}`);
            throw err
        }
    }

    public async getAllTableData(tableName: string): Promise<Record<string, any>[]> {
        try {
            this.ensureConnected();
            if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
                throw new Error (`[DatabaseService] Table name doesn't matched the allowed format, tableName: ${tableName}`);
            }
            const sql = `SELECT * FROM ${tableName}`;
            const result: Record<string, any>[] = await this.all(sql);
            return result;
        } catch (err) {
            console.error(`[DatabaseService] Error while getting all the table data: ${tableName}: ${err}`);
            throw err;
        }
    }
    
    // private async updateDataInSqlRow(tableName: string, inputObject: Record<string, any>): Promise<void> {
    //     // const columns: string[] = [
    //     //     'transferFromWhom',
    //     //     'transferToWhom',
    //     //     'transferFromAccountNo',
    //     //     'transferToAccountNo',
    //     //     'transferDateTime',
    //     //     'amount',
    //     //     'transactionID',
    //     //     'transferReceiptMemo',
    //     // ];
    //     // const fileLink = `${inputObject['fileLink']}`;
    //     // const setValues = [
    //     //     inputObject['transferFromWhom'],
    //     //     inputObject['transferToWhom'],
    //     //     inputObject['transferFromAccountNo'],
    //     //     inputObject['transferToAccountNo'],
    //     //     inputObject['transferDateTime'],
    //     //     inputObject['amount'],
    //     //     inputObject['transactionID'],
    //     //     inputObject['transferReceiptMemo'],
    //     // ];
    //     // const setClause = columns.map((col) => `${col} = ?`).join(', ');
    //     // const params = [...setValues, fileLink]

    //     // const sql = `UPDATE ${tableName} SET ${setClause} WHERE fileLink = ?`;

    //     // try {
    //     //     await this.run(sql, params);
    //     //     console.log(`[FileDownloaderAndConverter] Successfully updated row for fileLink: ${fileLink}`);
    //     // } catch (err) {
    //     //     console.error(`[FileDownloaderAndConverter] Error while updating data in sql database for fileLink: ${fileLink}: ${err}`);
    //     //     throw err;
    //     // }
    // }

}


export { DatabaseService, IColumnDefinition }