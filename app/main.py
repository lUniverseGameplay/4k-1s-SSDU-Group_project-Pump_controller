### Точка входа приложения. Создаёт экземпляр FastAPI, регистрирует роутеры, обработчики ошибок, middleware ###

from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello, World!"}