function promedio(){
    var IP = parseFloat(document.getElementById('IP').value);
    var IIP = parseFloat(document.getElementById('IIP').value);
    var IIIP = parseFloat(document.getElementById('IIIP').value);
    var IVP = parseFloat(document.getElementById('IVP').value);
    var promedio = (IP + IIP + IIIP + IVP) / 4;

    document.getElementById('resultado').value = promedio;
}