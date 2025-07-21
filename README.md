# 📜Tenant Payment Record Processor

This is a Node.js/TypeScript application designed to automate the archiving of file submissions from a Wix Form. It reads form submission data from a source CSV file, downloads the corresponding file uploads (which can be single/multiple images or single/multi-page PDFs), standardizes them into a single image file per submission, and archives them in a designated Google Drive folder.

## ✨Features

-   **CSV-Driven**: Initiates its workflow based on records from a Wix Form CSV export.

-   **Versatile File Handling**: Downloads files from URLs specified in the CSV. It correctly handles columns containing single or multiple file URLs (separated by semicolons).

-   **Universal File Conversion & Consolidation**:
    -   **Standardizes to JPG**: All downloaded files are converted to the JPG format for uniformity. This includes converting image formats like PNG, HEIC, WEBP, etc., to JPG.
    -   **PDF Processing**: Multi-page PDF files are converted into a series of individual JPG images, one for each page.
    -   **File Consolidation**: All resulting JPG images for a single submission are combined into **one wide, horizontally-stitched JPG file**, with individual images placed side-by-side.

-   **Dynamic File Naming**: Automatically renames the final consolidated file using the `Room Number` and a truncated `Submission time` from the CSV for easy identification.

-   **Database Integration**: Uses a persistent SQLite database to log processed submissions, **preventing the same CSV row from being processed more than once**.

-   **Cloud Storage**: Uploads the final, consolidated JPG files to a specific Google Drive folder for secure archival.

-   **Robust Setup**: Automatically creates required temporary directories and checks for necessary environment variables on startup.

-   **Environment-Aware Configuration**: Supports different `.env` files for `development` and `production` environments.

## ⚙️Workflow

The script follows a clear, automated workflow:

1.  **Initialization**:
    -   The application starts and loads the `GOOGLE_DRIVE_DESTINATION_FOLDER_ID` from the `.env` file.
    -   It creates a set of temporary directories (`temp_downloads`, `to_be_uploaded`, etc.) if they don't already exist.

2.  **Database Setup**:
    -   It connects to the SQLite database file (`sql/database_core.db`).
    -   It ensures a table exists to track the processing status of each form submission.

3.  **CSV Parsing**:
    -   The script parses a source CSV file exported from Wix Forms. It is designed to handle columns like `Submission time`, `Condo Name`, `Room Number`, and `File upload`.

4.  **File Processing Loop**:
    -   The script iterates through each row from the CSV. Before processing, **it checks the database to see if a submission has already been processed. If so, it is skipped.**
    -   For each new submission, the `FileDownloaderAndConverter` service performs the following:
        -   a. Downloads all files from the URL(s) in the `File upload` column.
        -   b. Converts any non-JPG file (like PDFs, PNGs, etc.) into the JPG format. PDFs are split into one JPG per page.
        -   c. All resulting JPG images for that one submission are combined into a single, wide JPG file, with images stitched together horizontally.
        -   d. The final consolidated JPG is named using the `Room Number` and `Submission time` (e.g., `"855/22, 2025-03-03T08:46:51.jpg"`).
        -   e. A record is saved in the SQLite database to mark the submission as processed.

5.  **Google Drive Upload**:
    -   After processing, the `GoogleInteraction` service authenticates with the Google Drive API.
    -   It uploads all the newly created consolidated JPG files from the `to_be_uploaded` directory to the specified Google Drive folder.
    -   Processed files are moved to an `already_uploaded` sub-directory to prevent re-uploading.

## 📋Source CSV Format
The bot is tailored to process CSV files exported from Wix Forms with the following structure. Note that the `File upload` column can contain one or more URLs separated by a semicolon.

```csv

"Submission time,Condo Name,Room Number,Advance Payment,File upload"

"2025-04-08T04:00:48.280Z,PDF one,111/222,1 Month,https://.../file.pdf"

"2025-03-06T10:57:49.593Z,Condo A,2210,1 Month,https://.../image.jpg"

"2025-03-03T08:46:51.838Z,Condo B,855/22,3 Month,https://.../img1.jpg; https://.../img2.jpg"

```

## 🚀Setup and Installation

1.  Clone the repository:

    ```sh

    git clone <your-repository-url>

    cd <repository-name>

    ```

2.  Install dependencies:

    ```sh

    npm install

    ```

3.  Set up Google Cloud Credentials:

    -   This script requires credentials to interact with Google Drive. You will need a credentials.json file from a Google Cloud project with the Google Drive API enabled. Place it in the root of the project.

4.  Configure Environment Variables:

    -   Create a .env file in the root of the project (or .env.development for development).

    -   Copy the contents of .env.example into your new file and add your Google Drive folder ID.

    .env.example

    ```env

    # The ID of the Google Drive folder where consolidated files will be uploaded

    GOOGLE_DRIVE_DESTINATION_FOLDER_ID="YOUR_GOOGLE_DRIVE_FOLDER_ID"

    ```

## ▶️Usage

To run the application, use the following commands:

For production:

(This will use the .env file)

```sh

npm run build

npm start

```

For development:

(This will use the .env.development file)

```sh

npm run dev

```

Alternatively, you can run the compiled JavaScript file directly:

```sh

node dist/index.js

```

## 🏗️Project Structure

```sh
.
├── data/                       # Holds the source CSV file from Wix Forms.
│   └── PaymentSlips.csv
├── dist/                       # Compiled JavaScript output.
├── sql/                        # Contains the SQLite database file.
│   └── database_core.db
├── src/                        # All TypeScript source code.
│   ├── services/               # Houses the core business logic modules.
│   │   ├── csvReader.js
│   │   ├── DatabaseService.js
│   │   ├── FileDownloaderAndConverter.js
│   │   ├── GoogleInteraction.js
│   │   └── SqliteAsyncWrapper.ts
│   └── main.ts                 # The main application entry point.
├── temp_downloads/             # Temporary directory for file processing.
│   ├── non_jpg_original/
│   ├── original_download/
│   ├── to_be_combined/
│   └── to_be_uploaded/         # Consolidated JPGs are placed here before upload.
├── .env                        # Production environment variables.
├── .env.development            # Development environment variables.
├── package.json                # Project dependencies and scripts.
└── tsconfig.json               # TypeScript compiler configuration.
```
