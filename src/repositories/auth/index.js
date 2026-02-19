const { env } = require("../../config/env");
const { User } = require("../../models/userModel");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

exports.createUser = async (username, password, email) => {
  return await User.create({ username, password, email });
};

exports.verifyToken = (token) => {
  return jwt.verify(token, env.JWT_SECRET);
};

exports.createToken = (id,username,email,role) =>{
    return jwt.sign({id,username,email,role},env.JWT_SECRET);
}

exports.checkUserExists = async (email) => {
  return await User.findOne({ email });
};

exports.checkById = async (id)=>{
  return await User.findById(id).select("-password");
}

exports.checkByUsername = async (username)=>{
  return await User.find({username});
}

exports.checkAllUser = async () =>{
  return await User.find();
}

/**
 * Update user by ID
 */
exports.updateUser = async (_id, updatedFields) => {
  return await User.findByIdAndUpdate(
    _id,
    { $set: updatedFields },
    { new: true }
  ).select("-password");
};

/**
 * Delete user by ID
 */
exports.deleteUser = async (_id) => {
  return await User.findByIdAndDelete(_id).select("-password");
};

exports.checkPassword = async (password, hashedPass) => {
  return await bcrypt.compare(password, hashedPass);
};
