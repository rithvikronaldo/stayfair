package ledger

import (
	"errors"
	"testing"
)

func TestCheckBalanced(t *testing.T) {
	cases := []struct {
		name    string
		entries []Entry
		wantErr bool
	}{
		{
			name: "balanced single currency INR",
			entries: []Entry{
				{Account: "cash", Amount: 1000000, Currency: "INR", Direction: DirIn},
				{Account: "host_payable", Amount: 850000, Currency: "INR", Direction: DirOut},
				{Account: "commission", Amount: 130000, Currency: "INR", Direction: DirOut},
				{Account: "gst_payable", Amount: 20000, Currency: "INR", Direction: DirOut},
			},
		},
		{
			name: "unbalanced by 100 paise",
			entries: []Entry{
				{Account: "cash", Amount: 1000000, Currency: "INR", Direction: DirIn},
				{Account: "host_payable", Amount: 999900, Currency: "INR", Direction: DirOut},
			},
			wantErr: true,
		},
		{
			name: "balanced across INR and USD independently",
			entries: []Entry{
				{Account: "cash_inr", Amount: 500000, Currency: "INR", Direction: DirIn},
				{Account: "host_inr", Amount: 500000, Currency: "INR", Direction: DirOut},
				{Account: "cash_usd", Amount: 10000, Currency: "USD", Direction: DirIn},
				{Account: "host_usd", Amount: 10000, Currency: "USD", Direction: DirOut},
			},
		},
		{
			name: "one currency balanced, other not",
			entries: []Entry{
				{Account: "cash_inr", Amount: 500000, Currency: "INR", Direction: DirIn},
				{Account: "host_inr", Amount: 500000, Currency: "INR", Direction: DirOut},
				{Account: "cash_usd", Amount: 10000, Currency: "USD", Direction: DirIn},
				{Account: "host_usd", Amount: 9999, Currency: "USD", Direction: DirOut},
			},
			wantErr: true,
		},
		{
			name:    "empty entries",
			entries: []Entry{},
			wantErr: true,
		},
		{
			name: "negative amount rejected",
			entries: []Entry{
				{Account: "cash", Amount: -100, Currency: "INR", Direction: DirIn},
				{Account: "host", Amount: -100, Currency: "INR", Direction: DirOut},
			},
			wantErr: true,
		},
		{
			name: "invalid direction rejected",
			entries: []Entry{
				{Account: "cash", Amount: 100, Currency: "INR", Direction: "sideways"},
			},
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckBalanced(tc.entries)
			if tc.wantErr && err == nil {
				t.Fatalf("want error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("want no error, got %v", err)
			}
		})
	}
}

func TestImbalanceErrorType(t *testing.T) {
	err := CheckBalanced([]Entry{
		{Account: "a", Amount: 100, Currency: "INR", Direction: DirIn},
		{Account: "b", Amount: 50, Currency: "INR", Direction: DirOut},
	})
	var ie ImbalanceError
	if !errors.As(err, &ie) {
		t.Fatalf("want ImbalanceError, got %T: %v", err, err)
	}
	if ie.Currency != "INR" || ie.In != 100 || ie.Out != 50 {
		t.Fatalf("unexpected fields: %+v", ie)
	}
}
