"use client";

import { useState } from "react";

// Types
type Item = { name: string; price: number };
type ReceiptData = { items: Item[]; vat: number; serviceCharge: number };

export default function BillSplitter() {
  const [persons, setPersons] = useState<string[]>(["A", "B", "C"]);
  const [newPerson, setNewPerson] = useState("");
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [assignments, setAssignments] = useState<Record<number, string[]>>({});
  
  // State สำหรับ API และ Image
  const [apiKey, setApiKey] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addPerson = () => {
    if (newPerson && !persons.includes(newPerson)) {
      setPersons([...persons, newPerson]);
      setNewPerson("");
    }
  };

  const toggleAssignment = (itemIndex: number, person: string) => {
    setAssignments((prev) => {
      const currentAssigned = prev[itemIndex] || [];
      if (currentAssigned.includes(person)) {
        return { ...prev, [itemIndex]: currentAssigned.filter((p) => p !== person) };
      } else {
        return { ...prev, [itemIndex]: [...currentAssigned, person] };
      }
    });
  };

  // จัดการเมื่อผู้ใช้อัปโหลดรูปภาพ
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setReceiptData(null); // Reset ข้อมูลเดิม
      setAssignments({});
      setError(null);
    }
  };

  // แปลงไฟล์รูปภาพเป็น Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = (error) => reject(error);
    });
  };

  // ยิง API ไปที่ Gemini
  const extractReceiptData = async () => {
    if (!apiKey) {
      setError("กรุณากรอก Gemini API Key");
      return;
    }
    if (!imageFile) {
      setError("กรุณาอัปโหลดรูปภาพใบเสร็จ");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const base64Image = await fileToBase64(imageFile);
      
      // Prompt สั่งให้ AI ดึงข้อมูลและบังคับ Output เป็น JSON เท่านั้น
      const prompt = `
        Analyze this restaurant receipt image carefully and extract the information into a specific JSON format.
        
        Rules for Extraction:
        1. Extract all food/drink items with their final prices.
        2. Discount Handling: If there is a discount applied specifically to an item (e.g., "Food1 50" followed by "Discount Food1 -5"), subtract the discount from the original price and output ONLY the final net price for that item (e.g., {"name": "Food1", "price": 45}). Do NOT list the discount as a separate item.
        3. Exclude 0 Baht Items: Ignore and remove any lines with a price of 0 if they are just informational, promotional text, or irrelevant to the actual consumable items.
        4. Extract the total VAT (Tax) amount and Service Charge amount if they exist. If they do not exist, set them to 0.
        
        Return ONLY a valid JSON object strictly matching this format without any markdown blocks or explanations:
        {
          "items": [
            {"name": "Item name 1", "price": 100},
            {"name": "Item name 2", "price": 150}
          ],
          "vat": 17.5,
          "serviceCharge": 25
        }
      `;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: imageFile.type, data: base64Image } },
                ],
              },
            ],
          }),
        }
      );

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || "API Error");
      }

      // ดึง Text ออกมาจาก Response
      let textResponse = data.candidates[0].content.parts[0].text;
      
      // ลบ Markdown formatting (เช่น ```json และ ```) กรณีที่ AI เผลอส่งมา
      textResponse = textResponse.replace(/```json/gi, "").replace(/```/gi, "").trim();

      const parsedData = JSON.parse(textResponse) as ReceiptData;
      setReceiptData(parsedData);
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || "เกิดข้อผิดพลาดในการประมวลผลข้อมูล กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsLoading(false);
    }
  };

  // ตรรกะคำนวณเงิน
  const calculateTotals = () => {
    if (!receiptData) return [];
    let baseTotals: Record<string, number> = {};
    let totalAssignedCost = 0;
    persons.forEach((p) => (baseTotals[p] = 0));

    receiptData.items.forEach((item, index) => {
      const assignedTo = assignments[index] || [];
      if (assignedTo.length > 0) {
        const costPerPerson = item.price / assignedTo.length;
        assignedTo.forEach((p) => {
          baseTotals[p] += costPerPerson;
          totalAssignedCost += costPerPerson;
        });
      }
    });

    return persons.map((person) => {
      const baseCost = baseTotals[person];
      const proportion = totalAssignedCost > 0 ? baseCost / totalAssignedCost : 0;
      const scShare = receiptData.serviceCharge * proportion;
      const vatShare = receiptData.vat * proportion;
      const total = baseCost + scShare + vatShare;

      return { name: person, baseCost, scShare, vatShare, total };
    }).filter((p) => p.baseCost > 0);
  };

  const results = calculateTotals();

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-800">AI Bill Concierge</h1>
          <p className="text-gray-500">อัปโหลดใบเสร็จ แล้วให้ AI ดึงข้อมูลพร้อมหารบิลแบบแฟร์ๆ</p>
        </div>

        {/* ส่วนตั้งค่า API และอัปโหลด */}
        <div className="bg-white p-6 rounded-xl shadow-sm border space-y-6">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="w-full md:w-1/2">
              <label className="block text-sm font-bold text-gray-700 mb-1">Gemini API Key (จำกัดเฉพาะในบราวเซอร์นี้)</label>
              <input 
                type="password" 
                value={apiKey} 
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..." 
                className="w-full border rounded-lg px-4 py-2 text-black focus:ring focus:ring-blue-200"
              />
            </div>
            <div className="w-full md:w-1/2">
              <label className="block text-sm font-bold text-gray-700 mb-1">อัปโหลดรูปภาพใบเสร็จ</label>
              <input 
                type="file" 
                accept="image/*"
                onChange={handleImageChange}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
          </div>

          {imagePreview && (
            <div className="flex flex-col items-center border-2 border-dashed border-gray-300 rounded-lg p-6">
              <img src={imagePreview} alt="Receipt Preview" className="max-h-64 object-contain mb-4 rounded" />
              <button 
                onClick={extractReceiptData}
                disabled={isLoading}
                className={`px-6 py-2 rounded-lg text-white font-bold transition ${
                  isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isLoading ? "กำลังให้ AI วิเคราะห์..." : "✨ วิเคราะห์ใบเสร็จด้วย AI"}
              </button>
              {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
            </div>
          )}
        </div>

        {/* ส่วนแสดงผลรายการอาหาร */}
        {receiptData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-black">เลือกรายการที่ทาน</h2>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newPerson} 
                    onChange={(e) => setNewPerson(e.target.value)}
                    placeholder="เพิ่มชื่อเพื่อน..." 
                    className="border rounded px-3 py-1 text-sm w-28 text-black"
                  />
                  <button onClick={addPerson} className="bg-gray-800 text-white px-3 py-1 rounded text-sm">+</button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-max">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="py-3 px-2 text-gray-700">รายการอาหาร</th>
                      <th className="py-3 px-2 text-right text-gray-700">ราคา</th>
                      {persons.map(p => (
                        <th key={p} className="py-3 px-2 text-center text-gray-700">{p}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {receiptData.items.map((item, idx) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-2 text-black">{item.name}</td>
                        <td className="py-3 px-2 text-right text-black">{item.price.toLocaleString()}฿</td>
                        {persons.map(p => (
                          <td key={p} className="py-3 px-2 text-center">
                            <input 
                              type="checkbox"
                              className="w-5 h-5 accent-blue-600 cursor-pointer"
                              checked={(assignments[idx] || []).includes(p)}
                              onChange={() => toggleAssignment(idx, p)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ส่วนสรุปผล */}
            <div className="bg-white p-6 rounded-xl shadow-sm border h-fit">
              <h2 className="text-xl font-bold mb-4 text-black">สรุปยอดสุทธิ</h2>
              <div className="bg-gray-100 p-4 rounded-lg mb-6 text-sm text-gray-700 space-y-1">
                <div className="flex justify-between"><span>ค่าอาหารรวม:</span> <span>{receiptData.items.reduce((sum, item) => sum + item.price, 0).toLocaleString()} ฿</span></div>
                <div className="flex justify-between"><span>Service Charge:</span> <span>{receiptData.serviceCharge.toLocaleString()} ฿</span></div>
                <div className="flex justify-between"><span>VAT:</span> <span>{receiptData.vat.toLocaleString()} ฿</span></div>
              </div>

              <div className="space-y-4">
                {results.map((res, idx) => (
                  <div key={idx} className="flex justify-between items-end border-b pb-4 border-gray-100">
                    <div>
                      <p className="font-bold text-lg text-black">{res.name}</p>
                      <p className="text-xs text-gray-500">
                        อาหาร {res.baseCost.toFixed(0)} | SC {res.scShare.toFixed(0)} | VAT {res.vatShare.toFixed(0)}
                      </p>
                    </div>
                    <p className="text-xl font-bold text-blue-600">{res.total.toFixed(2)} ฿</p>
                  </div>
                ))}
                
                {results.length === 0 && (
                  <p className="text-gray-400 text-center py-4 text-sm">กรุณาติ๊กเลือกรายการอาหารให้แต่ละคน</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}