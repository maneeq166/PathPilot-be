const { registerUser } = require("../../services/auth");

const {asyncHandler} = reqiure("../../utils/asyncHandler/index.js");
const ApiResponse = require("../../utils/apiResponse/index");
exports.handleRegistration = asyncHandler(async(req,res)=>{
    const {username,password,email,profilePicture} = req.body;

    const result = await registerUser(username,password,email,profilePicture);

    const {message,statusCode,data} = result;
    return res.status(statusCode).json(new ApiResponse(statusCode,data,message));
})