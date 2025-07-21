const onResolve = (result: string) => {
    console.log(`Resolved: ${result}`);
}

const onReject = (result: string) => {
    console.log(`Reject: ${result}`);
}

const mockPromise = async (shouldsuccess: boolean): Promise<string> => {

    console.log(`The Result is: ${shouldsuccess ? "Success" : "Failed"}`);

    return await new Promise((resolve, reject) => {
        console.log("New Promise is running")
        setTimeout (() => {
            console.log("Inside setTimeout")
            if (shouldsuccess) {
                resolve("Yay success");
                console.log("Promise resolve is called");
            } else {
                reject(new Error("Noo failed"));
                console.log("Promise Reject is called");
            }
        }, 0);
        console.log("Last line of Promise")
    });

}

console.log("Start");
const finalResult = mockPromise(true)
    .then(
        onResolve,
        onReject,
    );
console.log("Finished calling function");
console.log(finalResult);
console.log("End");