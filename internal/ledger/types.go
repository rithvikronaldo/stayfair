package ledger

import "time"

type Direction string

const (
	DirIn  Direction = "in"
	DirOut Direction = "out"
)

type Entry struct {
	Account   string    `json:"account"`
	Amount    int64     `json:"amount"`
	Currency  string    `json:"currency"`
	Direction Direction `json:"direction"`
}

type Transaction struct {
	Description string    `json:"description"`
	OccurredAt  time.Time `json:"occurred_at"`
	Entries     []Entry   `json:"entries"`
}
