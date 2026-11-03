### Главный файл приложения. Инициализирует FastAPI, настраивает логирование, регистрирует роутеры, запускает сервер ###

from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello, World!"}