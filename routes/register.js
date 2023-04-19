// This is the route for the register page domain.xyz/registrarse
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.render('usuarios/registrarse/index');
});

router.post('/', (req, res) => {

});

module.exports = router;