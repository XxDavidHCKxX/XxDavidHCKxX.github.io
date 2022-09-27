function suma(){
    var numero1 = parseFloat(document.getElementById('numero1').value);
    var resultado = numero1 * 1.10;
    
    document.getElementById('resultado').value = resultado;
}