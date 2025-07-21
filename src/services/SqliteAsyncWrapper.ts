import sqlite3 from 'sqlite3';
import type { Database } from 'sqlite3';


class SqliteAsyncWrapper {

    static open (filepath: string, mode?: number): Promise<Database> {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(filepath, mode ?? (sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE), (err) => {
                if (err) {
                    console.error(`[SqliteAsyncWrapper] Error opening database ${filepath}`, err);
                    reject(err);
                } else {
                    resolve(db);
                }
            });
        });
    }

    static run(db: Database, sql: string, params: any[] = []): Promise<{lastID: number, changes: number}> {

        return new Promise((resolve, reject) => {

            db.run(sql, params, function (err) {
                if (err) {
                    console.error(`[SqliteAsyncWrapper] Error while running sql: ${sql}, params: ${params}, err: ${err}`);
                    reject(err);
                } else {
                    resolve({
                        lastID: this.lastID,
                        changes: this.changes,
                    });
                }
            });
        });
    }

    static close(db:Database): Promise<void> {
        return new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) {
                    console.error(`[SqliteAsyncWrapper] Error while closing: ${err}`);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    static get<T>(db: Database, sql:string, params: any[] = []): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row: T) => {
                if (err) {
                    console.error(`[SqliteAsyncWrapper] Error while getting a single row: sql: ${sql}, params: ${params}, err: ${err}`);
                    reject(err);
                } else {
                    resolve(row);
                }
            })
        });
    }

    static all<T>(db: Database, sql:string, params: any[] = []): Promise<T[]> {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows: T[]) => {
                if (err) {
                    console.error(`[SqliteAsyncWrapper] Error while all rows: sql: ${sql}, params: ${params}, err: ${err}`);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
}


export { SqliteAsyncWrapper }