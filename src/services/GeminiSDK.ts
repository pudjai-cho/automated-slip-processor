import {
    GoogleGenAI,
    createUserContent,
    createPartFromUri,
} from '@google/genai'



class GeminiApi {

    private ai: GoogleGenAI;

    constructor(geminiApiKey: string) {
        this.ai = new GoogleGenAI({ apiKey: geminiApiKey });
    }

    private async imageToText(imagePath: string): Promise<string> {
        try {
            console.log(`[GeminiApi] Uploading file: ${imagePath}`);

            const uploadedImage = await this.ai.files.upload({ file: imagePath });
            if (!(uploadedImage.uri && uploadedImage.mimeType)) {
                throw new Error("[GeminiApi] Error while getting uploaded uploadedImage information")
            }
            console.log(`[GeminiApi] File uploaded successfully: URI ${uploadedImage.uri}`);

            const userPrompt = `Please create a JSON from this image. Use these keys: [transferFromWhom, transferToWhom, transferFromAccountNo, transferToAccountNo, transferDateTime, amount, transactionID, transferReceiptMemo].

For 'transferDateTime', use ISO 8601 format and timezone is UTC+7.
For 'amount', extract the numerical value, multiply it by 100, and provide the result as an integer (representing the value in the smallest currency unit, e.g., cents).
If a value isn't clear, use null.`

            const result = await this.ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                    createUserContent([
                        userPrompt,
                        createPartFromUri(uploadedImage.uri, uploadedImage.mimeType),
                    ]),
                ],
            });

            if (!result.text) {
                throw new Error("[GeminiApi] Response text not found");
            }
            return result.text;

        } catch (err) {
            console.error(`[GeminiApi] Error while processing file: ${imagePath}: ${err}`);
            throw err;
        }
    }

    private parseJSONString(inputString: string): object {
        try {


            const regex = /\{.*?\}/s;
            const match = inputString.match(regex);

            const result = match ? match[0] : null;

            if (!result) {
                throw ("[GeminiApi] Regex wasn't matched")
            }

            return JSON.parse(result);


        } catch (err) {
            console.error(`[GeminiApi] Error while parsing JSON string: ${err}`);
            throw err;
        }


    }

    public async geminiOCR(imagePath: string): Promise<object> {
        try {

            const geminiResponse = await this.imageToText(imagePath);
            const JSONResponse = this.parseJSONString(geminiResponse);
            return JSONResponse;

        } catch (err) {
            console.error(`[GeminiApi] Error while getting gemini OCR: ${err}`);
            throw err;
        }


    }
}

export { GeminiApi };