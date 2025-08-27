const { User } = require("../../models/userModel")

exports.createUser = async (username,password,email,profilePicture) =>{
    return await User.create({username,password,email,profilePicture});
}

exports.checkUserExists = async (email) =>{
    return await User.findOne({email});
}
