import AWS from "aws-sdk";
export const s3 = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT || ""),
  accessKeyId: process.env.DO_SPACES_KEY|| "",
  secretAccessKey: process.env.DO_SPACES_SECRET|| "",
  region: process.env.DO_SPACES_REGION|| "",
  s3ForcePathStyle: true,
});