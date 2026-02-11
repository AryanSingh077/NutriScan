let html5QrCode;

const statusText = document.getElementById("status-text");
const scanLine = document.getElementById("scan-line");
const resultCard = document.getElementById("result-card");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");

function startCamera() {
    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
    }

    startBtn.style.display = "none";
    stopBtn.style.display = "inline-block";
    resultCard.style.display = "none";
    scanLine.style.display = "block";
    statusText.innerText = "Point camera at a barcode...";

    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            stopCamera(); 
            statusText.innerText = "Scanned Code: " + decodedText;
            fetchData(decodedText);
        },
        (errorMessage) => {
        }
    ).catch(err => {
        console.error(err);
        statusText.innerText = "Camera Error: " + err;
        stopCamera();
    });
}

function stopCamera() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
        }).catch(err => console.log(err));
    }
    startBtn.style.display = "inline-block";
    stopBtn.style.display = "none";
    scanLine.style.display = "none";
}

async function fetchData(barcode) {
    statusText.innerText = "🔍 Fetching Data..."; 
    resultCard.style.display = "none"; 

    try {
        const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
        const data = await response.json();

        if (data.status === 1) {
            const product = data.product;
            
            statusText.innerText = "✅ Done!"; 
            resultCard.style.display = "block";
            
            document.getElementById("product-name").innerText = product.product_name || "Unknown Product";
            document.getElementById("product-brand").innerText = product.brands || "Unknown Brand";
            document.getElementById("product-img").src = product.image_url || "https://via.placeholder.com/150";

            const n = product.nutriments;
            const sugar = n.sugars_100g || 0;
            const fat = n.fat_100g || 0;
            const salt = n.salt_100g || 0;

            document.getElementById("kcal-val").innerText = Math.round(n['energy-kcal_100g'] || 0) + " kcal";
            document.getElementById("sugar-val").innerText = sugar.toFixed(1) + "g";
            document.getElementById("fat-val").innerText = fat.toFixed(1) + "g";
            document.getElementById("salt-val").innerText = salt.toFixed(1) + "g";

            const verdictBox = document.getElementById("verdict-box");
            verdictBox.className = "verdict"; 
            
            let redAlerts = [];
            if (sugar > 15) redAlerts.push("SUGAR");
            if (fat > 20) redAlerts.push("FAT");
            if (salt > 1.5) redAlerts.push("SALT");

            if (redAlerts.length > 0) {
                verdictBox.innerText = `🔴 HIGH ${redAlerts.join(" & ")}: LIMIT INTAKE`;
                verdictBox.classList.add("red");
            } else if (sugar > 5 || fat > 3) {
                verdictBox.innerText = "🟡 MODERATE: ENJOY IN MODERATION";
                verdictBox.classList.add("yellow");
            } else {
                verdictBox.innerText = "🟢 HEALTHY: GREAT CHOICE";
                verdictBox.classList.add("green");
            }
        } else {
            statusText.innerText = `❌ Product ${barcode} not found.`;
        }
    } catch (err) {
        statusText.innerText = "❌ Network Error. Check internet.";
    }
}